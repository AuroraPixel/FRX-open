"""Domain persistence for saves, their history, memories, settings and portrait recipes.

The ``value`` properties are projections for the running engine, not storage blobs or an
import adapter. Relationships and ownership live in foreign keys; JSON is reserved for the
game's evolving state fields and individual snapshot payloads.
"""

import copy
import hashlib
import json
from contextlib import nullcontext
from functools import lru_cache
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    event,
    select,
)
from sqlalchemy.orm import (
    Mapped,
    Session,
    mapped_column,
    object_session,
    relationship,
    synonym,
    undefer,
)

from . import snapshot_storage
from .card_snapshots import KEPT, NEAR, SERVER_FIELDS, TABLES, is_kept
from .domain import ROOT
from .storage import Base

SNAPSHOT_FIELDS = (
    *SERVER_FIELDS, TABLES, "biographySnapshot", "worldMapSnapshot", "snapshotOfLogs",
)
PART_FIELD = "@part:"


def clone(value):
    return copy.deepcopy(value)


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def same(left, right):
    # JSON booleans and numbers are distinct even though Python True == 1.
    return encoded(left) == encoded(right)


def assign(row, name, value):
    if not same(getattr(row, name, None), value):
        setattr(row, name, clone(value))


def document(value, label):
    if not isinstance(value, dict):
        raise HTTPException(422, f"{label}必须是对象")
    return value


def missing_snapshot():
    return HTTPException(422, "完整状态快照缺失，存档没有被完整读取")


STATE_FIELDS = {
    "currentState": "state_tables",
    "worldMap": "world_map",
    "worldBookEntries": "biographies",
    "frxProgress": "progress",
    "dailyItemUses": "daily_item_uses",
    "frxPlay": "life_state",
    "npcAvatars": "avatars",
    "bondedCharacters": "bonded_characters",
    "rpgMaps": "scene_maps",
    "latestDailyPaper": "daily_paper",
}


class Archive(Base):
    __tablename__ = "archives"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_archive_owner_name"),
        CheckConstraint("version >= 1", name="ck_archive_version"),
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    key = synonym("name")
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    document_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    data_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    state: Mapped["ArchiveState | None"] = relationship(
        back_populates="archive", cascade="all, delete-orphan", uselist=False, lazy="selectin",
    )
    logs: Mapped[list["ArchiveLog"]] = relationship(
        back_populates="archive", cascade="all, delete-orphan", order_by="ArchiveLog.position",
        lazy="selectin",
    )
    collection = "archives"

    @property
    def value(self):
        return archive_value(self, lean=getattr(self, "_lean", False))

    @value.setter
    def value(self, value):
        session = object_session(self)
        # Replacing snapshot relationships can lazy-load. Validate limits after the whole write.
        with session.no_autoflush if session is not None else nullcontext():
            self._set_value(value)

    def _set_value(self, value):
        self._value_written = True
        if value is None:
            self.deleted = True
            self.state = None
            self.logs = []
            self.document_meta, self.data_meta = {}, {}
            return
        value = document(value, "存档")
        data = document(value.get("data"), "存档数据")
        identity = data.get("archiveId")
        if not isinstance(identity, str) or not identity:
            raise HTTPException(422, "存档缺少稳定编号")
        if self.archive_id and self.archive_id != identity:
            raise HTTPException(422, "存档编号不能修改")
        self.archive_id, self.deleted = identity, False
        assign(self, "document_meta", {k: v for k, v in value.items() if k not in {"name", "data"}})
        assign(self, "data_meta", {k: v for k, v in data.items()
                                  if k not in {"archiveId", "state", "logs"}})
        if self.state is None:
            self.state = ArchiveState(user_id=self.user_id, archive_id=identity)
        self.state.value = document(data.get("state"), "存档状态")
        incoming = data.get("logs")
        if not isinstance(incoming, list):
            raise HTTPException(422, "历史记录必须是列表")
        # Stable log IDs identify edits and reordering; an ID-less initial passage keeps its slot.
        existing = {row.slot: row for row in self.logs}
        owned_snapshots = {ref.snapshot_digest: ref for row in self.logs for ref in row.snapshots}
        rows, used, snapshots = [], set(), {}
        for position, log in enumerate(incoming):
            log = document(log, "历史记录")
            identity = log.get("id")
            slot = "id:" + str(identity) if identity is not None else "position:" + str(position)
            if slot in used:
                raise HTTPException(422, "同一存档的历史编号不能重复")
            used.add(slot)
            row = existing.get(slot)
            if row is None:
                row = ArchiveLog(user_id=self.user_id, archive_id=self.archive_id,
                                 id=str(uuid4()), slot=slot, position=position)
            row.position = position
            row.set_value(log, snapshots, owned_snapshots)
            rows.append(row)
        self.logs = rows


class ArchiveState(Base):
    __tablename__ = "archive_states"
    __table_args__ = (ForeignKeyConstraint(
        ["user_id", "archive_id"], ["archives.user_id", "archives.archive_id"],
        ondelete="CASCADE", name="fk_state_archive",
    ),)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    state_tables: Mapped[dict | None] = mapped_column(JSON)
    world_map: Mapped[dict | None] = mapped_column(JSON)
    biographies: Mapped[list | None] = mapped_column(JSON)
    progress: Mapped[dict | None] = mapped_column(JSON)
    daily_item_uses: Mapped[dict | None] = mapped_column(JSON)
    life_state: Mapped[dict | None] = mapped_column(JSON)
    avatars: Mapped[dict | None] = mapped_column(JSON)
    bonded_characters: Mapped[dict | None] = mapped_column(JSON)
    scene_maps: Mapped[dict | None] = mapped_column(JSON)
    daily_paper: Mapped[dict | None] = mapped_column(JSON)
    present: Mapped[list] = mapped_column(JSON, default=list)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    archive: Mapped[Archive] = relationship(back_populates="state")

    @property
    def value(self):
        result = clone(self.extra or {})
        for field in self.present or []:
            result[field] = clone(getattr(self, STATE_FIELDS[field]))
        return result

    @value.setter
    def value(self, value):
        for field, column in STATE_FIELDS.items():
            assign(self, column, value.get(field))
        assign(self, "present", [field for field in STATE_FIELDS if field in value])
        assign(self, "extra", {k: v for k, v in value.items() if k not in STATE_FIELDS})


class ArchiveLog(Base):
    __tablename__ = "archive_logs"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "archive_id"],
                             ["archives.user_id", "archives.archive_id"], ondelete="CASCADE"),
        UniqueConstraint("user_id", "archive_id", "slot", name="uq_archive_log_identity"),
        Index("ix_archive_log_order", "user_id", "archive_id", "position"),
        CheckConstraint("position >= 0", name="ck_archive_log_position"),
    )
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300))
    slot: Mapped[str] = mapped_column(String(340))
    position: Mapped[int] = mapped_column(Integer)
    log_id: Mapped[str | None] = mapped_column(String(300))
    kind: Mapped[str | None] = mapped_column(String(32))
    content: Mapped[str | None] = mapped_column(Text)
    timestamp: Mapped[str | None] = mapped_column(String(80))
    present: Mapped[list] = mapped_column(JSON, default=list)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    archive: Mapped[Archive] = relationship(back_populates="logs")
    snapshots: Mapped[list["LogSnapshotRef"]] = relationship(
        back_populates="log", cascade="all, delete-orphan", lazy="selectin",
    )

    def set_value(self, value, cache, owned_snapshots):
        fields = {"id": "log_id", "type": "kind", "content": "content", "timestamp": "timestamp"}
        for field, column in fields.items():
            content = value.get(field)
            if content is not None and not isinstance(content, str):
                raise HTTPException(422, f"历史记录的{field}必须是文本")
            assign(self, column, content)
        assign(self, "present", [field for field in fields if field in value])
        assign(self, "extra", {k: v for k, v in value.items()
                               if k not in fields and k not in SNAPSHOT_FIELDS})
        existing = {ref.field: ref for ref in self.snapshots}
        refs = []
        for field in SNAPSHOT_FIELDS:
            if field not in value:
                continue
            payload = value[field]
            ref = existing.get(field)
            if is_kept(payload):
                # Only references already belonging to this exact log may come back from a
                # lean engine read. Imports must supply full snapshot payloads.
                if ref is None or ref.snapshot_digest != payload["sha256"]:
                    raise missing_snapshot()
                refs.append(ref)
                refs.extend(parts_for(existing, field))
                continue
            if field == "snapshotOfLogs":
                # A summary may carry a copy of the lean logs it replaced. Make this undo
                # snapshot self-contained before their direct references are collected.
                payload = expand_nested_snapshots(payload, owned_snapshots)
            raw = encoded(payload).encode()
            digest = snapshot_storage.digest(raw)
            if ref is None:
                ref = LogSnapshotRef(user_id=self.user_id, log_id=self.id, field=field)
            if ref.snapshot_digest == digest:
                refs.extend(parts_for(existing, field))
            else:
                refs.extend(store_field(self, ref, payload, raw, cache, existing))
            refs.append(ref)
        self.snapshots = refs

    def fields_value(self):
        fields = {"id": "log_id", "type": "kind", "content": "content", "timestamp": "timestamp"}
        return {**clone(self.extra or {}),
                **{field: getattr(self, fields[field]) for field in self.present or []}}

    def value(self, lean=False, keep_tables=True, seen=None, payloads=None):
        result = self.fields_value()
        for ref in self.snapshots:
            if ref.field not in SNAPSHOT_FIELDS:
                continue
            if lean and (ref.field in SERVER_FIELDS or (ref.field == TABLES and not keep_tables)):
                stub = {"codec": KEPT, "sha256": ref.snapshot_digest, "bytes": ref.size}
                if ref.field == TABLES:
                    names = set(ref.names or [])
                    stub["met"] = sorted(names - (seen or set()))
                    if seen is not None:
                        seen.update(names)
                result[ref.field] = stub
            else:
                if payloads is None:
                    held = ref.snapshot
                    if held is None:
                        raise missing_snapshot()
                    payload = held.payload
                    if snapshot_storage.parts_of(payload):
                        siblings = parts_for({item.field: item for item in self.snapshots}, ref.field)
                        payload = snapshot_storage.restored(payload, {
                            item.snapshot_digest: item.snapshot.payload for item in siblings
                        }, {})
                else:
                    if ref.snapshot_digest not in payloads:
                        raise missing_snapshot()
                    payload = payloads[ref.snapshot_digest]
                result[ref.field] = clone(payload)
                if ref.field == TABLES and seen is not None:
                    seen.update(ref.names or [])
        return result


class Snapshot(Base):
    __tablename__ = "snapshots"
    __table_args__ = (CheckConstraint("size >= 0", name="ck_snapshot_size"),)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[object] = mapped_column(JSON, nullable=False, deferred=True)
    size: Mapped[int] = mapped_column(Integer)


class LogSnapshotRef(Base):
    __tablename__ = "log_snapshot_refs"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "log_id"], ["archive_logs.user_id", "archive_logs.id"],
                             ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "snapshot_digest"],
                             ["snapshots.user_id", "snapshots.digest"]),
        Index("ix_snapshot_references", "user_id", "snapshot_digest"),
    )
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    log_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    field: Mapped[str] = mapped_column(String(64), primary_key=True)
    snapshot_digest: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer, default=0)
    names: Mapped[list] = mapped_column(JSON, default=list)
    log: Mapped[ArchiveLog] = relationship(back_populates="snapshots", overlaps="snapshot")
    snapshot: Mapped[Snapshot] = relationship(overlaps="log,snapshots")


def parts_for(refs, field):
    prefix = f"{PART_FIELD}{field}:"
    return [ref for name, ref in refs.items() if name.startswith(prefix)]


def put_snapshot(log, digest, payload, raw, cache):
    if digest not in cache:
        session = object_session(log)
        held = session.get(Snapshot, (log.user_id, digest)) if session is not None else None
        cache[digest] = held if held is not None else Snapshot(
            user_id=log.user_id, digest=digest, payload=clone(payload), size=len(raw),
        )
    return cache[digest]


def attach(ref, held):
    ref.snapshot = held
    ref.snapshot_digest = held.digest
    ref.size = held.size


def store_field(log, ref, payload, raw, cache, existing):
    stored, parts = snapshot_storage.stored_payload(ref.field, payload, raw)
    stored_raw = encoded(stored).encode() if parts else raw
    digest = snapshot_storage.digest(stored_raw)
    if digest == ref.snapshot_digest:
        return parts_for(existing, ref.field)
    attach(ref, put_snapshot(log, digest, stored, stored_raw, cache))
    if ref.field == TABLES:
        from .play_blocks import round_names

        ref.names = sorted(round_names(payload))
    else:
        ref.names = []
    refs = []
    for index, (key, part) in enumerate(parts.items()):
        field = f"{PART_FIELD}{ref.field}:{index}"
        child = existing.get(field)
        if child is None:
            child = LogSnapshotRef(user_id=log.user_id, log_id=log.id, field=field, names=[])
        attach(child, put_snapshot(log, key, part, encoded(part).encode(), cache))
        refs.append(child)
    return refs


def snapshot_rows(session, user_id, digests):
    found = {}
    ordered = sorted(set(digests))
    for start in range(0, len(ordered), 400):
        rows = session.scalars(select(Snapshot).options(undefer(Snapshot.payload)).where(
            Snapshot.user_id == user_id, Snapshot.digest.in_(ordered[start:start + 400]),
        ))
        found.update({row.digest: row for row in rows})
    needed = set(ordered) - found.keys()
    found.update({row.digest: row for row in session.new if isinstance(row, Snapshot)
                  and row.user_id == user_id and row.digest in needed})
    return found


def snapshot_payloads(session, user_id, digests):
    with session.no_autoflush:
        roots = {key: row.payload for key, row in snapshot_rows(session, user_id, digests).items()}
        parts = {key for value in roots.values() for key in snapshot_storage.parts_of(value)}
        gathered = {key: row.payload for key, row in snapshot_rows(session, user_id, parts).items()}
    decoded = {}
    return {key: snapshot_storage.restored(value, gathered, decoded) for key, value in roots.items()}


def compact_archive_snapshots(row):
    """Replace large standalone snapshots in an existing archive within the owner's transaction."""
    session = object_session(row)
    if session is None:
        return 0
    with session.no_autoflush:
        candidates = {ref.snapshot_digest for log in row.logs for ref in log.snapshots
                      if ref.field in SNAPSHOT_FIELDS and ref.size >= snapshot_storage.MINIMUM * 2}
        stored = snapshot_rows(session, row.user_id, candidates)
        originals = {key: item.payload for key, item in stored.items()
                     if not snapshot_storage.parts_of(item.payload)}
        if not originals:
            return 0
        cache = {}
        count = 0
        for log in row.logs:
            fields = {ref.field: ref for ref in log.snapshots}
            converted = []
            for ref in tuple(log.snapshots):
                if ref.field not in SNAPSHOT_FIELDS or ref.snapshot_digest not in originals:
                    continue
                payload = originals[ref.snapshot_digest]
                before = ref.snapshot_digest
                converted.extend(store_field(log, ref, payload, encoded(payload).encode(), cache, fields))
                if before != ref.snapshot_digest:
                    count += 1
            if converted:
                log.snapshots = [*log.snapshots, *(ref for ref in converted if ref.field not in fields)]
        return count


MEMORY_FIELDS = {
    "id": "public_id", "uuid": "uuid", "timestamp": "recorded_at",
    "scope": "scope", "archiveId": "archive_id", "frxBatchId": "batch_id",
    "frxBatchDigest": "batch_digest", "outdatedTimestamp": "retired_at",
    "title": "title", "content": "content", "vector": "embedding", "source": "source",
    "frxRetired": "retired", "frxTimelineHidden": "hidden", "metadata": "details",
}


class Memory(Base):
    __tablename__ = "memories"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "archive_id"],
                             ["archives.user_id", "archives.archive_id"], ondelete="CASCADE"),
        Index("ix_memory_archive", "user_id", "archive_id", "deleted"),
        Index("ix_memory_batch", "user_id", "batch_id"),
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    archive_id: Mapped[str | None] = mapped_column(String(300))
    public_id: Mapped[object | None] = mapped_column(JSON)
    uuid: Mapped[str | None] = mapped_column(String(36))
    recorded_at: Mapped[object | None] = mapped_column(JSON)
    retired_at: Mapped[object | None] = mapped_column(JSON)
    scope: Mapped[str | None] = mapped_column(String(24))
    batch_id: Mapped[str | None] = mapped_column(String(64))
    batch_digest: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(JSON)
    retired: Mapped[bool | None] = mapped_column(Boolean)
    hidden: Mapped[bool | None] = mapped_column(Boolean)
    details: Mapped[dict | None] = mapped_column(JSON)
    present: Mapped[list] = mapped_column(JSON, default=list)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    collection = "vectors"

    @property
    def value(self):
        if self.deleted:
            return None
        value = clone(self.extra or {})
        value.update({k: clone(getattr(self, MEMORY_FIELDS[k])) for k in self.present or []})
        return value

    @value.setter
    def value(self, value):
        self.deleted = value is None
        if value is None:
            for column in MEMORY_FIELDS.values():
                setattr(self, column, None)
            self.extra, self.present = {}, []
            return
        value = document(value, "记忆")
        for field, column in MEMORY_FIELDS.items():
            assign(self, column, value.get(field))
        if value.get("scope") == "global":
            self.archive_id = None
        assign(self, "present", [field for field in MEMORY_FIELDS if field in value])
        assign(self, "extra", {k: v for k, v in value.items() if k not in MEMORY_FIELDS})


class UserSetting(Base):
    __tablename__ = "user_settings"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    setting: Mapped[object | None] = mapped_column(JSON)
    collection = "settings"

    @property
    def value(self):
        return None if self.deleted else {"key": self.key, "value": clone(self.setting)}

    @value.setter
    def value(self, value):
        self.deleted = value is None
        self.setting = clone(document(value, "设置").get("value")) if value is not None else None


class ArchiveArt(Base):
    __tablename__ = "archive_art"
    __table_args__ = (ForeignKeyConstraint(
        ["user_id", "archive_id"], ["archives.user_id", "archives.archive_id"], ondelete="CASCADE",
    ),)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    key = synonym("archive_id")
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    summary: Mapped[dict | None] = mapped_column(JSON)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    portraits: Mapped[list["Portrait"]] = relationship(cascade="all, delete-orphan")
    collection = "play_art"

    @property
    def value(self):
        if self.deleted:
            return None
        value = {"archiveId": self.archive_id, **clone(self.extra or {}), "portraits": {}}
        if self.summary is not None:
            value["summary"] = clone(self.summary)
        for portrait in self.portraits:
            field = "portraits" if portrait.kind == "id" else "portraitsByName"
            value.setdefault(field, {})[portrait.identity] = clone(portrait.recipe)
        return value

    @value.setter
    def value(self, value):
        self.deleted = value is None
        if value is None:
            self.portraits = []
            self.summary, self.extra = None, {}
            return
        value = document(value, "存档形象")
        assign(self, "summary", value.get("summary"))
        assign(self, "extra", {
            k: v for k, v in value.items()
            if k not in {"archiveId", "summary", "portraits", "portraitsByName"}
        })
        existing = {(p.kind, p.identity): p for p in self.portraits}
        rows = []
        for field, kind in (("portraits", "id"), ("portraitsByName", "name")):
            for identity, recipe in (value.get(field) or {}).items():
                row = existing.get((kind, identity)) or Portrait(
                    user_id=self.user_id, archive_id=self.archive_id, kind=kind, identity=identity,
                )
                assign(row, "recipe", recipe)
                rows.append(row)
        self.portraits = rows


class Portrait(Base):
    __tablename__ = "archive_portraits"
    __table_args__ = (ForeignKeyConstraint(
        ["user_id", "archive_id"], ["archive_art.user_id", "archive_art.archive_id"],
        ondelete="CASCADE",
    ),)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    kind: Mapped[str] = mapped_column(String(8), primary_key=True)
    identity: Mapped[str] = mapped_column(String(300), primary_key=True)
    recipe: Mapped[dict] = mapped_column(JSON)


MODELS = {"archives": Archive, "settings": UserSetting, "vectors": Memory, "play_art": ArchiveArt}
DOMAIN_MODELS = (Archive, ArchiveState, ArchiveLog, Snapshot, LogSnapshotRef,
                 Memory, UserSetting, ArchiveArt, Portrait)


def model_for(collection):
    try:
        return MODELS[collection]
    except KeyError:
        raise HTTPException(422, "不支持的数据领域") from None


def new_record(user_id, collection, key, value, version=1):
    model = model_for(collection)
    identity = {"name": key} if model is Archive else {"key": key}
    row = model(user_id=user_id, version=version, **identity)
    row.value = value
    return row


def records_query(user_id, collection):
    model = model_for(collection)
    return select(model).where(model.user_id == user_id)


def get_record(session, user_id, collection, key, lock=False, lean=False):
    model = model_for(collection)
    query = records_query(user_id, collection).where(model.key == key)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = session.scalar(query)
    if isinstance(row, Archive):
        row._lean = lean
    return row


def iter_records(session, user_id, collections=None):
    for collection in collections or MODELS:
        model = model_for(collection)
        yield from session.scalars(records_query(user_id, collection).order_by(model.key))


@lru_cache(maxsize=1)
def demo_map():
    return json.loads((ROOT / "content/map.json").read_text(encoding="utf-8"))


def add_demo_coast(state):
    """Extend the original demo map when reading a save, preserving its existing places."""
    world = state.get("worldMap")
    if not isinstance(world, dict) or world.get("width") != 430:
        return state
    regions = world.get("main_regions")
    if not isinstance(regions, list) or [region.get("name") for region in regions
                                        if isinstance(region, dict)] != ["潮岚道"]:
        return state

    expanded = demo_map()
    world["width"] = expanded["width"]
    for field in ("terrains", "main_regions", "sub_regions", "points_of_interest"):
        existing = world.get(field) or []
        names = {entry.get("name") for entry in existing if isinstance(entry, dict)}
        world[field] = existing + [clone(entry) for entry in expanded[field] if entry["name"] not in names]
    return state


def archive_storage_bytes(row):
    """Count the stored archive fields and each referenced snapshot once, using reference sizes."""
    size = len(encoded({
        **(row.document_meta or {}), "name": row.name,
        "data": {**(row.data_meta or {}), "archiveId": row.archive_id,
                 "state": row.state.value, "logs": []},
    }).encode())
    snapshots = {}
    for log in row.logs:
        size += len(encoded(log.fields_value()).encode())
        for ref in log.snapshots:
            snapshots[ref.snapshot_digest] = ref.size
            if ref.field.startswith(PART_FIELD):
                size += len(ref.field) + len(ref.snapshot_digest)
    return size + sum(snapshots.values())


def archive_value(row, lean=False):
    if row.deleted:
        return None
    if row.state is None:
        raise HTTPException(422, "存档当前状态缺失")
    logs = sorted(row.logs, key=lambda item: item.position)
    needed = {
        ref.snapshot_digest for at, log in enumerate(logs) for ref in log.snapshots
        if ref.field in SNAPSHOT_FIELDS and (not lean or ref.field not in SERVER_FIELDS
        and (ref.field != TABLES or at == 0 or at >= len(logs) - NEAR))
    }
    session = object_session(row)
    payloads = snapshot_payloads(session, row.user_id, needed) if session is not None else None
    seen = set()
    return {**clone(row.document_meta or {}), "name": row.name,
            "data": {**clone(row.data_meta or {}), "archiveId": row.archive_id,
                     "state": add_demo_coast(row.state.value),
                     "logs": [log.value(lean, at == 0 or at >= len(logs) - NEAR, seen, payloads)
                              for at, log in enumerate(logs)]}}


def materialize_value(session, user_id, value):
    if not value:
        return value
    stubs = [(log, field) for log in value["data"].get("logs", [])
             for field in SNAPSHOT_FIELDS if is_kept(log.get(field))]
    digests = {log[field]["sha256"] for log, field in stubs}
    found = snapshot_payloads(session, user_id, digests)
    if digests - found.keys():
        raise missing_snapshot()
    for log, field in stubs:
        log[field] = clone(found[log[field]["sha256"]])
    return value


def expand_nested_snapshots(value, owned, resolving=None):
    """Resolve the current archive's nested undo references before it drops their logs."""
    if is_kept(value):
        digest = value["sha256"]
        ref = owned.get(digest)
        active = resolving or set()
        if ref is None or digest in active or ref.snapshot is None:
            raise missing_snapshot()
        session = object_session(ref)
        if session is None:
            restored = ref.snapshot.payload
            if snapshot_storage.parts_of(restored):
                parts = parts_for({item.field: item for item in ref.log.snapshots}, ref.field)
                restored = snapshot_storage.restored(restored, {
                    item.snapshot_digest: item.snapshot.payload for item in parts
                }, {})
        else:
            restored = snapshot_payloads(session, ref.user_id, [digest])[digest]
        return expand_nested_snapshots(restored, owned, active | {digest})
    if isinstance(value, dict):
        return {key: expand_nested_snapshots(item, owned, resolving) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_nested_snapshots(item, owned, resolving) for item in value]
    return clone(value)


@event.listens_for(Session, "before_flush")
def deduplicate_snapshots(session, _context, _instances):
    """Deduplicate snapshots attached with two new archives in the same transaction.

    Application writers hold the owner's lock, so the database lookup is stable until commit.
    The foreign key still rejects an uncoordinated writer rather than mixing owners.
    """
    changed = list(session.new) + list(session.dirty) + list(session.deleted)
    affected = {row.user_id for row in changed
                if isinstance(row, Archive | ArchiveLog | LogSnapshotRef | Snapshot)}
    session.info.setdefault("snapshot_gc_users", set()).update(affected)
    fresh = [row for row in session.new if isinstance(row, Snapshot)]
    if not fresh:
        return
    canonical, replaced = {}, {}
    with session.no_autoflush:
        for row in fresh:
            key = (row.user_id, row.digest)
            held = canonical.get(key)
            if held is None:
                held = session.get(Snapshot, key)
            if held is None:
                held = row
            canonical[key] = held
            if held is not row:
                if not same(held.payload, row.payload):
                    raise HTTPException(422, "快照摘要冲突")
                replaced[row] = held
    for ref in list(session.new) + list(session.dirty):
        if isinstance(ref, LogSnapshotRef) and ref.snapshot in replaced:
            attach(ref, replaced[ref.snapshot])
    for row in replaced:
        session.expunge(row)


@event.listens_for(Session, "after_flush_postexec")
def collect_unused_snapshots(session, _context):
    users = session.info.pop("snapshot_gc_users", set())
    if users:
        referenced = select(LogSnapshotRef.snapshot_digest).where(
            LogSnapshotRef.user_id == Snapshot.user_id,
            LogSnapshotRef.snapshot_digest == Snapshot.digest,
        ).exists()
        session.execute(delete(Snapshot).where(Snapshot.user_id.in_(users), ~referenced)
                        .execution_options(synchronize_session="fetch"))
    for row in session.identity_map.values():
        if isinstance(row, Archive):
            row._value_written = False
