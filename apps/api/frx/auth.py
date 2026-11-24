"""Who is asking: users, passwords, sessions, the two modes and the access levels.

FRX_AUTH=off (the default) is local mode: no login, every request is the built-in local user, a
fixed row of the users table and an administrator without a password, who signs in with one only
after an administrator gives it a name and a password (frx.admin claim-local). FRX_AUTH=on is
multi-user mode: a request is the user of its session cookie (frx_session), and every route
declares who may call it with one of three dependencies (the access levels):

- `public`: anyone (health, signing in and registering, the page shells and static art);
- `login`: a signed-in user; without a valid session the answer is 401 unauthorized;
- `admin`: an administrator; a player gets 403 forbidden.

tests/test_auth.py checks that every route of the application carries one of them. The route
functions take the user from `current_user`, which returns the session's user (or the local
user), so nothing below the routes needs to know which mode the server runs in.

Passwords are kept as argon2id hashes, sessions as the SHA-256 of a random token (the token
itself lives only in the browser's cookie) and invite codes as the SHA-256 of the code. Failed
logins are counted per user name and per address; five within 15 minutes lock that name or that
address for 15 minutes.
"""

import asyncio
import hashlib
import logging
import os
import re
import secrets
import threading
import time
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import Depends, Request
from sqlalchemy import JSON, Float, ForeignKey, Integer, String, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .play_errors import PlayError
from .storage import Base, now
from .usage import Limits, duration, limits_for

logger = logging.getLogger(__name__)

LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001"
LOCAL_USERNAME = "local"
COOKIE = "frx_session"
MODES = ("off", "on")
REGISTRATION = ("invite", "closed", "open")
# The last activity is written at most this often; each write extends the session.
TOUCH_SECONDS = 600
THROTTLE_FAILURES = 5
THROTTLE_SECONDS = 15 * 60


class UserRecord(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(24))
    # Names are unique regardless of case: the key is the casefolded name.
    username_key: Mapped[str] = mapped_column(String(24), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(8))  # admin | player
    status: Mapped[str] = mapped_column(String(8), default="active")  # active | disabled
    limits: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # None: the defaults
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    last_login_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class SessionRecord(Base):
    """A signed-in browser. Times are seconds since the epoch."""

    __tablename__ = "user_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)
    last_seen_at: Mapped[float] = mapped_column(Float)


class InviteRecord(Base):
    """A one-time invite code, kept as its hash."""

    __tablename__ = "invites"
    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    used_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    used_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class ThrottleRecord(Base):
    """Failed logins of one user name ("name:…") or one address ("addr:…")."""

    __tablename__ = "login_throttle"
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer)
    window_start: Mapped[float] = mapped_column(Float)
    locked_until: Mapped[float | None] = mapped_column(Float, nullable=True)


@dataclass(frozen=True)
class User:
    id: str
    username: str
    role: str
    # The user's effective limits (frx.usage.limits_for); None: no limits (local mode).
    limits: Limits | None = None
    # The hash of the session token the request came with; None in local mode.
    session: str | None = None


LOCAL_USER = User(LOCAL_USER_ID, LOCAL_USERNAME, "admin")


def local_user_row():
    """The built-in user's row as the schema baseline inserts it."""
    return dict(
        id=LOCAL_USER_ID,
        username=LOCAL_USERNAME,
        username_key=LOCAL_USERNAME,
        password_hash=None,
        role="admin",
        status="active",
        limits=None,
        created_at=now(),
        last_login_at=None,
    )


# ---------------------------------------------------------------- modes


def auth_mode():
    """FRX_AUTH as given ("off" when unset); check_mode refuses anything but off and on."""
    return os.getenv("FRX_AUTH", "off").strip().lower() or "off"


def registration_mode():
    return os.getenv("FRX_REGISTRATION", "invite").strip().lower() or "invite"


def session_lifetime():
    raw = os.getenv("FRX_SESSION_DAYS", "30")
    try:
        days = float(raw)
    except ValueError:
        days = -1
    if not 0 < days <= 3650:
        raise RuntimeError(f"FRX_SESSION_DAYS={raw}：请写 0 到 3650 之间的天数")
    return days * 86400


def check_mode():
    """Refuse to start in a mode this build does not know, rather than serve everyone as the
    local user when login was asked for (or the other way round)."""
    mode = auth_mode()
    if mode not in MODES:
        raise RuntimeError(f"FRX_AUTH={mode}：只认 off（本机模式，默认）和 on（多用户模式）")
    if mode == "on":
        registration = registration_mode()
        if registration not in REGISTRATION:
            raise RuntimeError(
                f"FRX_REGISTRATION={registration}：只认 invite（凭邀请码，默认）、"
                "closed（只能由管理员建号）和 open（自由注册）"
            )
        session_lifetime()


# ---------------------------------------------------------------- names, passwords, codes

NAME = re.compile(r"[A-Za-z0-9_\-㐀-䶿一-鿿豈-﫿]{3,24}")


def invalid(message):
    return PlayError(422, "invalid_input", message)


def username_key(raw):
    """The key a name is found and compared by: NFKC, trimmed, casefolded."""
    return unicodedata.normalize("NFKC", raw or "").strip().casefold()


def check_username(raw):
    """(name as kept, its key) for a new name; raises 422 invalid_input."""
    name = unicodedata.normalize("NFKC", raw or "").strip()
    if not NAME.fullmatch(name):
        raise invalid("用户名要 3 到 24 个字符，只能用字母、数字、下划线、连字符和汉字")
    key = name.casefold()
    if key == LOCAL_USERNAME:
        raise invalid("这个用户名留给本机玩家，请换一个")
    return name, key


def check_password(password, username):
    if len(password) < 8:
        raise invalid("密码至少要 8 个字符")
    if len(password) > 128:
        raise invalid("密码最多 128 个字符")
    if password.casefold() == (username or "").casefold():
        raise invalid("密码不能和用户名相同")


def hasher():
    """argon2id with the library's defaults (RFC 9106's low-memory profile: 64 MiB, 3 passes,
    4 lanes). Tests swap in a cheaper one through PASSWORDS."""
    from argon2 import PasswordHasher

    return PasswordHasher()


PASSWORDS = None
_DUMMY = None
# Each hash takes 64 MiB for a moment: a burst of sign-ins waits its turn instead.
HASHING = threading.BoundedSemaphore(4)


def passwords():
    global PASSWORDS
    if PASSWORDS is None:
        PASSWORDS = hasher()
    return PASSWORDS


def hash_password(password):
    with HASHING:
        return passwords().hash(password)


def verify_password(stored, password):
    """Whether the password matches; a missing hash is checked against a dummy one, so an
    unknown name costs as long as a wrong password."""
    from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

    global _DUMMY
    if not stored:
        if _DUMMY is None:
            _DUMMY = hash_password(secrets.token_urlsafe(16))
        stored, password = _DUMMY, password + "\0"
    try:
        with HASHING:
            return passwords().verify(stored, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


# Crockford's base32 letters: no I, L, O or U to misread.
CODE_LETTERS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_invite_code():
    """A random code of 16 letters (80 bits), written in groups of four."""
    letters = "".join(secrets.choice(CODE_LETTERS) for _ in range(16))
    return "-".join(letters[i : i + 4] for i in range(0, 16, 4))


def invite_hash(code):
    """The key of a code as kept: upper case, without spaces and dashes, O read as 0 and I or
    L as 1, then SHA-256."""
    plain = re.sub(r"[\s\-]", "", (code or "").upper()).translate(str.maketrans("OIL", "011"))
    return hashlib.sha256(plain.encode()).hexdigest()


def iso(seconds):
    return datetime.fromtimestamp(seconds, UTC).isoformat()


# ---------------------------------------------------------------- the accounts service


class Accounts:
    """Users, passwords, sessions, invites and the login throttle over the shared database.

    These tables have no row-level security: signing in has to find any user by name."""

    def __init__(self, sessions, mode=None, registration=None, mailer=None):
        from .email_login import EmailLogin
        from .mail_delivery import SMTPMailer

        self.sessions = sessions
        self.mode = auth_mode() if mode is None else mode
        self.registration = registration_mode() if registration is None else registration
        self.lifetime = session_lifetime() if self.mode == "on" else 30 * 86400
        self.clock = time.time
        self.email = EmailLogin(self, mailer if mailer is not None else SMTPMailer())

    @property
    def on(self):
        return self.mode == "on"

    def user_of(self, row, session_hash=None):
        return User(
            row.id, row.username, row.role,
            limits=limits_for(row.role, row.limits, self.mode), session=session_hash,
        )

    # ------------------------------------------------------------ sessions

    def open_session(self, session, user_id):
        """A new session for the user, written in `session`; returns the token."""
        token = secrets.token_urlsafe(32)
        moment = self.clock()
        session.execute(
            delete(SessionRecord).where(
                SessionRecord.user_id == user_id, SessionRecord.expires_at <= moment
            )
        )
        session.add(SessionRecord(
            token_hash=token_hash(token), user_id=user_id, created_at=moment,
            expires_at=moment + self.lifetime, last_seen_at=moment,
        ))
        return token

    def authenticate(self, request):
        """The user of the request's session cookie, or None. One query; every TOUCH_SECONDS
        a second one moves the session's last activity and expiry on (and the cookie with it,
        through request.state.frx_cookie, which main.py writes on the response)."""
        token = request.cookies.get(COOKIE)
        if not token or len(token) > 200:
            return None
        digest = token_hash(token)
        moment = self.clock()
        with self.sessions() as session:
            row = session.execute(
                select(SessionRecord.expires_at, SessionRecord.last_seen_at, UserRecord.id,
                       UserRecord.username, UserRecord.role, UserRecord.status,
                       UserRecord.limits)
                .join(UserRecord, UserRecord.id == SessionRecord.user_id)
                .where(SessionRecord.token_hash == digest)
            ).first()
            if row is None or row.expires_at <= moment or row.status != "active":
                request.state.frx_cookie = ("clear",)
                return None
            if moment - row.last_seen_at >= TOUCH_SECONDS:
                session.execute(
                    update(SessionRecord)
                    .where(SessionRecord.token_hash == digest)
                    .values(last_seen_at=moment, expires_at=moment + self.lifetime)
                )
                session.commit()
                request.state.frx_cookie = ("set", token)
        return self.user_of(row, digest)

    def close_session(self, digest):
        with self.sessions.begin() as session:
            session.execute(delete(SessionRecord).where(SessionRecord.token_hash == digest))

    @staticmethod
    def close_sessions(session, user_id, keep=None):
        """End every session of the user (but `keep`, a token hash)."""
        query = delete(SessionRecord).where(SessionRecord.user_id == user_id)
        if keep:
            query = query.where(SessionRecord.token_hash != keep)
        session.execute(query)

    # ------------------------------------------------------------ the login throttle

    def wait_for(self, session, keys):
        """Seconds until none of these keys is locked."""
        moment = self.clock()
        rows = session.scalars(select(ThrottleRecord).where(ThrottleRecord.key.in_(keys))).all()
        return max([row.locked_until - moment for row in rows
                    if row.locked_until and row.locked_until > moment] or [0])

    def failed(self, keys):
        moment = self.clock()
        for _ in range(2):
            try:
                with self.sessions.begin() as session:
                    for key in keys:
                        row = session.get(ThrottleRecord, key, with_for_update=True)
                        if row is None:
                            row = ThrottleRecord(key=key, failures=0, window_start=moment)
                            session.add(row)
                        elif moment - row.window_start > THROTTLE_SECONDS:
                            row.failures, row.window_start = 0, moment
                        row.failures += 1
                        if row.failures >= THROTTLE_FAILURES:
                            row.locked_until = moment + THROTTLE_SECONDS
                            row.failures, row.window_start = 0, moment
                return
            except IntegrityError:
                continue  # another failure created the row first: count again

    def refuse_if_locked(self, keys):
        with self.sessions() as session:
            wait = self.wait_for(session, keys)
        if wait > 0:
            raise PlayError(
                429, "too_many_attempts",
                f"登录失败的次数太多，请 {duration(wait)}后再试",
                headers={"Retry-After": str(int(wait) + 1)},
            )

    @staticmethod
    def throttle_keys(key, address):
        return ["name:" + key[:150], "addr:" + (address or "unknown")[:150]]

    # ------------------------------------------------------------ signing in

    def login(self, username, password, address):
        """(user, token) for a right name and password; 401 for anything else, worded the same
        whether the name exists or not; 403 for a disabled account; 429 while locked."""
        if not self.on:
            raise PlayError(403, "forbidden", "本机模式没有账号，不需要登录")
        key = username_key(username)
        keys = self.throttle_keys(key, address)
        self.refuse_if_locked(keys)
        with self.sessions() as session:
            row = session.scalar(select(UserRecord).where(UserRecord.username_key == key))
        if not verify_password(row.password_hash if row else None, password):
            self.failed(keys)
            raise PlayError(401, "unauthorized", "用户名或密码不对")
        if row.status != "active":
            raise PlayError(403, "forbidden", "这个账号已停用，请联系管理员")
        with self.sessions.begin() as session:
            session.execute(delete(ThrottleRecord).where(ThrottleRecord.key == keys[0]))
            stored = session.get(UserRecord, row.id)
            if passwords().check_needs_rehash(stored.password_hash):
                stored.password_hash = hash_password(password)
            stored.last_login_at = now()
            token = self.open_session(session, row.id)
        return self.user_of(row, token_hash(token)), token

    def register(self, username, password, invite, address):
        """A new player, signed in at once: (user, token)."""
        if not self.on:
            raise PlayError(403, "forbidden", "本机模式没有账号，不需要注册")
        if self.registration == "closed":
            raise PlayError(403, "forbidden", "现在不开放注册，请向管理员要一个账号")
        name, key = check_username(username)
        check_password(password, name)
        code = (invite or "").strip()
        if self.registration == "invite" and not code:
            raise invalid("请填写邀请码")
        hashed = hash_password(password)
        moment = self.clock()
        user_id = str(uuid4())
        try:
            with self.sessions.begin() as session:
                if session.scalar(select(UserRecord.id).where(UserRecord.username_key == key)):
                    raise invalid("这个用户名已经有人用了")
                session.add(UserRecord(
                    id=user_id, username=name, username_key=key, password_hash=hashed,
                    role="player", status="active", limits=None, created_at=now(),
                    last_login_at=now(),
                ))
                session.flush()
                if self.registration == "invite":
                    taken = session.execute(
                        update(InviteRecord)
                        .where(
                            InviteRecord.code_hash == invite_hash(code),
                            InviteRecord.used_at.is_(None),
                            (InviteRecord.expires_at.is_(None))
                            | (InviteRecord.expires_at > moment),
                        )
                        .values(used_by=user_id, used_at=moment)
                    ).rowcount
                    if taken != 1:
                        raise invalid("邀请码无效、已过期或已经用过")
                token = self.open_session(session, user_id)
                row = session.get(UserRecord, user_id)
                user = self.user_of(row, token_hash(token))
        except IntegrityError:
            raise invalid("这个用户名已经有人用了") from None
        logger.info("account_registered")
        return user, token

    def change_password(self, user, old, new):
        """Set a new password after checking the old one; the user's other sessions end."""
        if not self.on or not user.session:
            raise PlayError(403, "forbidden", "本机模式没有账号密码")
        with self.sessions() as session:
            row = session.get(UserRecord, user.id)
        if not row.password_hash:
            raise PlayError(403, "forbidden", "这个账号使用邮箱验证码登录，没有账号密码")
        keys = self.throttle_keys(row.username_key, None)[:1]
        self.refuse_if_locked(keys)
        if not verify_password(row.password_hash, old):
            self.failed(keys)
            raise invalid("原密码不对")
        check_password(new, row.username)
        hashed = hash_password(new)
        with self.sessions.begin() as session:
            stored = session.get(UserRecord, user.id)
            stored.password_hash = hashed
            self.close_sessions(session, user.id, keep=user.session)

    def user_row(self, user_id):
        with self.sessions() as session:
            return session.get(UserRecord, user_id)


# ---------------------------------------------------------------- the access levels


def current_user(request: Request) -> User:
    """FastAPI dependency: the user a request acts for. Local mode: the built-in local user.
    Multi-user mode: the user of the session cookie; without a valid one, 401 unauthorized."""
    accounts = getattr(request.app.state, "accounts", None)
    if accounts is None or not accounts.on:
        return LOCAL_USER
    user = getattr(request.state, "frx_user", None)
    if user is None:
        user = accounts.authenticate(request)
        if user is None:
            raise PlayError(401, "unauthorized", "请先登录")
        request.state.frx_user = user
    return user


async def public() -> None:
    """Access level: anyone, signed in or not."""


async def login(user: User = Depends(current_user)) -> User:
    """Access level: a signed-in user (in local mode, the local player)."""
    return user


async def admin(user: User = Depends(current_user)) -> User:
    """Access level: an administrator (in local mode, the local player, who is one)."""
    if user.role != "admin":
        raise PlayError(403, "forbidden", "只有管理员能做这件事")
    return user


LEVELS = {public: "public", login: "login", admin: "admin"}


async def model_quota(request: Request, user: User = Depends(current_user)) -> None:
    """Before a route that calls the model: 429 quota_exceeded while the user is at a cost or
    turn limit of the last 24 hours (multi-user mode only)."""
    meter = getattr(request.app.state, "meter", None)
    if meter is not None and meter.mode == "on":
        await asyncio.to_thread(meter.check, user)


def set_cookie(response, cookie, *, secure, lifetime):
    """Write what a request decided about its session cookie on the response."""
    if cookie[0] == "set":
        response.set_cookie(
            COOKIE, cookie[1], max_age=int(lifetime), path="/", secure=secure,
            httponly=True, samesite="lax",
        )
    else:
        response.delete_cookie(COOKIE, path="/", secure=secure, httponly=True, samesite="lax")
