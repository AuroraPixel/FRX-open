"""Email identities and one-time login codes, with durable delivery and abuse limits.

These account tables have no player RLS: an unauthenticated browser must find its identity.
Email and address transaction locks serialize limits and consumption across server processes.
SMTP runs outside the transaction; only a successfully delivered challenge can be consumed.
"""

import hashlib
import hmac
import math
import re
import secrets
from uuid import uuid4

from sqlalchemy import Float, ForeignKey, Integer, String, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .auth import UserRecord, iso, token_hash
from .play_errors import PlayError
from .storage import Base

CODE_SECONDS = 600
RESEND_SECONDS = 60
WINDOW_SECONDS = 3600
EMAIL_SEND_LIMIT = 6
IP_SEND_LIMIT = 30
IP_FAILURE_LIMIT = 20
CODE_FAILURE_LIMIT = 5


class EmailIdentity(Base):
    __tablename__ = "email_identities"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"),
                                       primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    verified_at: Mapped[float] = mapped_column(Float)


class EmailLoginChallenge(Base):
    __tablename__ = "email_login_challenges"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    challenge_id: Mapped[str] = mapped_column(String(36))
    code_digest: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)
    resend_at: Mapped[float] = mapped_column(Float)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class EmailSendLimit(Base):
    __tablename__ = "email_send_limits"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    window_start: Mapped[float] = mapped_column(Float)
    sent: Mapped[int] = mapped_column(Integer)


class EmailIPLimit(Base):
    __tablename__ = "email_ip_limits"
    address_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    send_window_start: Mapped[float] = mapped_column(Float)
    sent: Mapped[int] = mapped_column(Integer)
    verify_window_start: Mapped[float] = mapped_column(Float)
    failures: Mapped[int] = mapped_column(Integer)


LOCAL_PART = re.compile(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~\-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~\-]+)*")
DOMAIN_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?")


def normalize_email(raw):
    """ASCII dot-atom local names and IDNA domains; no display names or header characters."""
    bad = PlayError(422, "invalid_input", "请填写有效的邮箱地址")
    if not isinstance(raw, str) or len(raw) > 320 or any(ord(c) < 32 or ord(c) == 127 for c in raw):
        raise bad
    parts = raw.strip().split("@")
    if len(parts) != 2:
        raise bad
    local, domain = parts
    if len(local) > 64 or not LOCAL_PART.fullmatch(local):
        raise bad
    try:
        domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise bad from None
    labels = domain.split(".")
    if len(labels) < 2 or any(not DOMAIN_LABEL.fullmatch(label) for label in labels):
        raise bad
    email = local.lower() + "@" + domain
    if len(email) > 254:
        raise bad
    return email


def throttled(wait):
    seconds = max(1, math.ceil(wait))
    return PlayError(429, "too_many_attempts", "验证码操作太频繁，请稍后再试",
                     headers={"Retry-After": str(seconds)})


class EmailLogin:
    def __init__(self, accounts, mailer):
        self.accounts, self.mailer = accounts, mailer
        self.sessions = accounts.sessions

    @property
    def available(self):
        return self.accounts.on and self.mailer.configured

    def require_available(self):
        if not self.accounts.on:
            raise PlayError(403, "forbidden", "本机模式没有账号，不需要登录")
        if not self.mailer.configured:
            raise PlayError(503, "email_unavailable", "邮箱登录暂未开放，请使用账号密码登录")

    @staticmethod
    def lock(session, email, address_hash=None):
        if session.bind.dialect.name == "sqlite":
            session.execute(text("BEGIN IMMEDIATE"))
        elif session.bind.dialect.name == "postgresql":
            keys = ["email:" + email]
            if address_hash:
                keys.append("ip:" + address_hash)
            for key in sorted(keys):
                session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                                {"key": "frx-email-login:" + key})

    @staticmethod
    def address_key(address):
        return hashlib.sha256((address or "unknown").encode()).hexdigest()

    def digest(self, email, challenge_id, code):
        payload = "\0".join((email, challenge_id, code)).encode()
        return hmac.new(self.mailer.code_secret.encode(), payload, hashlib.sha256).hexdigest()

    @staticmethod
    def identity(session, email):
        return session.scalar(select(EmailIdentity).where(EmailIdentity.email == email))

    def email_of(self, user_id):
        with self.sessions() as session:
            row = session.get(EmailIdentity, user_id)
            return row.email if row else None

    @staticmethod
    def ip_limit(session, address_hash, moment):
        row = session.get(EmailIPLimit, address_hash)
        if row is None:
            row = EmailIPLimit(address_hash=address_hash, send_window_start=moment, sent=0,
                               verify_window_start=moment, failures=0)
            session.add(row)
        if moment - row.send_window_start >= WINDOW_SECONDS:
            row.send_window_start, row.sent = moment, 0
        if moment - row.verify_window_start >= WINDOW_SECONDS:
            row.verify_window_start, row.failures = moment, 0
        return row

    def send(self, raw_email, address):
        self.require_available()
        email = normalize_email(raw_email)
        ip = self.address_key(address)
        challenge_id, code = str(uuid4()), f"{secrets.randbelow(1000000):06d}"
        with self.sessions.begin() as session:
            self.lock(session, email, ip)
            moment = self.accounts.clock()
            identity = self.identity(session, email)
            if identity is None and self.accounts.registration == "closed":
                raise PlayError(403, "forbidden", "现在不开放注册，请使用已有账号登录")
            row = session.get(EmailLoginChallenge, email)
            if row is not None and row.resend_at > moment:
                raise throttled(row.resend_at - moment)
            # Resending must invalidate the previous digits even if the random draw repeats.
            while row is not None and hmac.compare_digest(
                row.code_digest, self.digest(email, row.challenge_id, code)
            ):
                code = f"{secrets.randbelow(1000000):06d}"
            budget = session.get(EmailSendLimit, email)
            if budget is None:
                budget = EmailSendLimit(email=email, window_start=moment, sent=0)
                session.add(budget)
            if moment - budget.window_start >= WINDOW_SECONDS:
                budget.window_start, budget.sent = moment, 0
            ip_budget = self.ip_limit(session, ip, moment)
            waits = []
            if budget.sent >= EMAIL_SEND_LIMIT:
                waits.append(budget.window_start + WINDOW_SECONDS - moment)
            if ip_budget.sent >= IP_SEND_LIMIT:
                waits.append(ip_budget.send_window_start + WINDOW_SECONDS - moment)
            if waits:
                raise throttled(max(waits))
            budget.sent += 1
            ip_budget.sent += 1
            if row is None:
                row = EmailLoginChallenge(email=email)
                session.add(row)
            row.challenge_id = challenge_id
            row.code_digest = self.digest(email, challenge_id, code)
            row.status, row.failures, row.consumed_at = "pending", 0, None
            row.created_at, row.expires_at = moment, moment + CODE_SECONDS
            row.resend_at = moment + RESEND_SECONDS
        try:
            self.mailer.send_code(email, code)
        except Exception:
            with self.sessions.begin() as session:
                self.lock(session, email)
                row = session.get(EmailLoginChallenge, email)
                if row and row.challenge_id == challenge_id and row.status == "pending":
                    row.status = "failed"
            raise PlayError(503, "email_unavailable", "验证码邮件发送失败，请稍后再试") from None
        with self.sessions.begin() as session:
            self.lock(session, email)
            row = session.get(EmailLoginChallenge, email)
            if row and row.challenge_id == challenge_id and row.status == "pending":
                row.status = "delivered"
                row.expires_at = self.accounts.clock() + CODE_SECONDS
        return {"retryAfter": RESEND_SECONDS, "expiresIn": CODE_SECONDS}

    def new_user(self, session, moment):
        # A distinct nickname never comes from the private mailbox local part. A savepoint
        # also handles a nickname reserved concurrently through password registration.
        for _ in range(5):
            name = "道友" + secrets.token_hex(8)
            try:
                with session.begin_nested():
                    row = UserRecord(id=str(uuid4()), username=name, username_key=name,
                                     password_hash=None, role="player", status="active",
                                     limits=None, created_at=iso(moment), last_login_at=iso(moment))
                    session.add(row)
                    session.flush()
                return row
            except IntegrityError:
                continue
        raise PlayError(503, "email_unavailable", "暂时无法建立账号，请稍后再试")

    def login(self, raw_email, code, address):
        self.require_available()
        email = normalize_email(raw_email)
        ip = self.address_key(address)
        error = None
        with self.sessions.begin() as session:
            self.lock(session, email, ip)
            moment = self.accounts.clock()
            budget = self.ip_limit(session, ip, moment)
            if budget.failures >= IP_FAILURE_LIMIT:
                raise throttled(budget.verify_window_start + WINDOW_SECONDS - moment)
            challenge = session.get(EmailLoginChallenge, email)
            valid = bool(challenge and challenge.status == "delivered"
                         and challenge.expires_at > moment
                         and challenge.failures < CODE_FAILURE_LIMIT
                         and re.fullmatch(r"[0-9]{6}", code or "")
                         and hmac.compare_digest(challenge.code_digest,
                                                 self.digest(email, challenge.challenge_id, code)))
            if not valid:
                budget.failures += 1
                if challenge and challenge.status == "delivered":
                    challenge.failures += 1
                    if challenge.failures >= CODE_FAILURE_LIMIT:
                        challenge.status = "failed"
                error = PlayError(401, "unauthorized", "验证码不正确、已过期或已使用，请重新获取")
            else:
                identity = self.identity(session, email)
                row = (session.get(UserRecord, identity.user_id, with_for_update=True)
                       if identity else None)
                if row is not None and row.status != "active":
                    error = PlayError(403, "forbidden", "这个账号已停用，请联系管理员")
                elif row is None and self.accounts.registration == "closed":
                    error = PlayError(403, "forbidden", "现在不开放注册，请使用已有账号登录")
                else:
                    if row is None:
                        row = self.new_user(session, moment)
                        session.add(EmailIdentity(user_id=row.id, email=email, verified_at=moment))
                    challenge.status, challenge.consumed_at = "consumed", moment
                    row.last_login_at = iso(moment)
                    token = self.accounts.open_session(session, row.id)
                    user = self.accounts.user_of(row, token_hash(token))
        # Failed attempts must commit their limits, so raise only after the transaction exits.
        if error:
            raise error
        return user, token
