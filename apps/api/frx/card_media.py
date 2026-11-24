"""Content-addressed raster media shared by saves, uploads and backups, owned per user.

A file is stored once under its content digest, whoever sent it; who may read it is recorded in
user_files. Two players who upload the same picture each get a row, and a name nobody registered
answers 404 exactly like a missing file.
"""

import base64
import hashlib
import os
import re
import tempfile
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import ForeignKey, Integer, String, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .storage import Base, bind_user, now

IMAGE = "image"
PAGE = "page"
MEDIA_NAME = re.compile(r"[0-9a-f]{64}\.(png|jpg|gif|webp)")
# How a save names a stored picture: this prefix and the file's name. It is the address the old
# page fetched pictures from; saves and backups have always carried it, so it stays the form
# even though nothing serves it any more (no interface shows these pictures).
ADDRESS = "/api/card/media/"


class UserFile(Base):
    __tablename__ = "user_files"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(8), primary_key=True)  # image | page
    name: Mapped[str] = mapped_column(String(80), primary_key=True)
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


def data_dir():
    from .domain import ROOT

    return Path(os.getenv("FRX_DATA_DIR", ROOT / ".frx"))


def owns(user_id, session, kind, name):
    return session.get(UserFile, (user_id, kind, name)) is not None


def register(user_id, session, kind, name, size, quota=None):
    """Record that this user owns the file; a new image must fit within the user's quota.

    The row is written at once, so the same picture met twice in one save counts once, and two
    uploads of it racing each other leave one row instead of a key conflict."""
    if owns(user_id, session, kind, name):
        return
    if quota is not None:
        used = session.scalar(
            select(func.coalesce(func.sum(UserFile.size), 0)).where(
                UserFile.user_id == user_id, UserFile.kind == kind
            )
        )
        if used + size > quota:
            raise HTTPException(
                413, f"图片总量将超过上限（{quota // (1024 * 1024)}MB），请先删除不用的存档或图片"
            )
    if session.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    row = dict(user_id=user_id, kind=kind, name=name, size=size, created_at=now())
    session.execute(insert(UserFile).values(**row).on_conflict_do_nothing())


def write_once(directory, name, data, prefix):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / name
    if not target.exists():
        fd, temporary = tempfile.mkstemp(dir=directory, prefix=prefix)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return target


# The packed snapshots found to hold no inline picture (batch 8): by digest, with the hash of their
# data, so the very same bytes are not unpacked again on the next write. On a long save every write
# carried every round's snapshot, and unpacking each one was most of a turn's CPU. Other bytes under
# a known digest are looked at as ever (and refused when they do not match it).
CLEAN = {}
CLEAN_MOST = 100_000


def clean(value):
    """Whether a packed snapshot holds no inline picture, its data whole and matching its sha256."""
    from .card_snapshots import holds

    digest, data = value.get("sha256"), value.get("data")
    if isinstance(data, str) and CLEAN.get(digest) == hash(data):
        return True
    if holds(value, b"data:image/"):
        return False
    if len(CLEAN) >= CLEAN_MOST:
        CLEAN.clear()
    CLEAN[digest] = hash(data)
    return True


class CardMedia:
    """One user's view of the shared media directory.

    quota is the most image bytes this user may own, or None for no limit (local mode).
    """

    def __init__(self, user_id, sessions, quota=None):
        if not isinstance(user_id, str) or not user_id:
            raise ValueError("CardMedia needs the id of the user whose files it serves")
        self.user_id = user_id
        self.sessions = bind_user(sessions, user_id)
        self.quota = quota
        self.directory = data_dir() / "media"

    @staticmethod
    def filename(data):
        if len(data) > 15 * 1024 * 1024:
            raise HTTPException(413, "单个媒体文件超过15MB")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            suffix = ".png"
        elif data.startswith(b"\xff\xd8\xff"):
            suffix = ".jpg"
        elif data.startswith((b"GIF87a", b"GIF89a")):
            suffix = ".gif"
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            suffix = ".webp"
        else:
            raise HTTPException(422, "请上传PNG、JPEG、GIF或WebP图片")
        return hashlib.sha256(data).hexdigest() + suffix

    def store(self, data, session=None):
        """Keep the picture and register it to this user; within `session` when given, so the
        registration commits or rolls back with the write that brought the picture."""
        filename = self.filename(data)
        if session is None:
            with self.sessions.begin() as own:
                return self.store(data, own)
        register(self.user_id, session, IMAGE, filename, len(data), self.quota)
        write_once(self.directory, filename, data, ".upload-")
        return ADDRESS + filename

    def resolve(self, filename):
        if not MEDIA_NAME.fullmatch(filename):
            raise HTTPException(404, "图片不存在")
        with self.sessions() as session:
            if not owns(self.user_id, session, IMAGE, filename):
                raise HTTPException(404, "图片不存在")
        target = self.directory / filename
        if not target.is_file():
            raise HTTPException(404, "图片不存在")
        return target

    def normalize(self, value, session=None):
        """The value with every inline picture (a data URI) stored and named by its address."""
        if isinstance(value, str) and value.startswith("data:image/"):
            try:
                metadata, body = value.split(",", 1)
                if ";base64" not in metadata:
                    raise ValueError
                data = base64.b64decode(body, validate=True)
            except (ValueError, TypeError):
                raise HTTPException(422, "图片数据格式无效") from None
            return self.store(data, session)
        if isinstance(value, str) and "data:image/" in value:
            # Historical state is often JSON inside a string, or HTML inside a log.
            # Replacing the URI itself preserves that surrounding representation.
            return re.sub(
                r"data:image/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+",
                lambda match: self.normalize(match[0], session),
                value,
            )
        if isinstance(value, list):
            return [self.normalize(item, session) for item in value]
        if isinstance(value, dict):
            from .card_snapshots import CODEC, pack_snapshot, unpack_snapshot

            if value.get("codec") == CODEC:
                # a packed snapshot with no picture in it is kept as it is: unpacked and packed
                # again it comes out the same, at the cost of every round's snapshot on every write
                if clean(value):
                    return value
                return pack_snapshot(self.normalize(unpack_snapshot(value), session))
            return {key: self.normalize(item, session) for key, item in value.items()}
        return value
