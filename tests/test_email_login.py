"""Email login against SQLite and the isolated PostgreSQL application role; no real mail."""

import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from frx.admin import Admin
from frx.auth import SessionRecord, UserRecord
from frx.email_login import (
    CODE_FAILURE_LIMIT,
    EMAIL_SEND_LIMIT,
    IP_FAILURE_LIMIT,
    IP_SEND_LIMIT,
    EmailIdentity,
    EmailIPLimit,
    EmailLoginChallenge,
    EmailSendLimit,
    normalize_email,
)
from frx.play_errors import PlayError
from sqlalchemy import func, select, text
from test_auth import ACCOUNT
from test_auth import server as server


class FakeMailer:
    configured = True
    code_secret = "test-only-hmac-secret-with-no-delivery"

    def __init__(self):
        self.messages = []
        self.fail = False

    def send_code(self, email, code):
        self.messages.append((email, code))
        if self.fail:
            raise RuntimeError("private smtp credential that must never reach the response")


@pytest.fixture
def email_server(server):
    server.mailer = FakeMailer()
    server.email = server.accounts.email
    server.email.mailer = server.mailer
    server.time = SimpleNamespace(now=1000000.0)
    server.accounts.clock = lambda: server.time.now
    return server


def counts(server):
    with server.store.sessions() as session:
        return tuple(session.scalar(select(func.count()).select_from(model)) for model in
                     (UserRecord, EmailIdentity, SessionRecord))


def code_for(server, email="player@example.com", address="127.0.0.1"):
    server.email.send(email, address)
    return server.mailer.messages[-1][1]


def failure(call):
    try:
        return call()
    except PlayError as error:
        return error


def test_options_and_verification_create_a_passwordless_player_without_an_invite(email_server):
    s = email_server
    options = s.client.get(ACCOUNT + "/options").json()
    assert options == {"mode": "accounts", "registration": "invite",
                       "emailLogin": True, "emailRegistration": True}
    sent = s.client.post(ACCOUNT + "/email/code", json={"email": " PLAYER@Example.com "})
    assert sent.status_code == 200 and sent.json() == {"retryAfter": 60, "expiresIn": 600}
    assert counts(s) == (1, 0, 0)
    email, code = s.mailer.messages[-1]
    assert email == "player@example.com" and len(code) == 6 and code.isascii() and code.isdigit()
    with s.store.sessions() as session:
        challenge = session.get(EmailLoginChallenge, email)
        assert challenge.code_digest == s.email.digest(email, challenge.challenge_id, code)
        assert challenge.code_digest != code and len(challenge.code_digest) == 64
    signed = s.client.post(ACCOUNT + "/email/login", json={"email": email, "code": code})
    assert signed.status_code == 200, signed.text
    user = signed.json()["user"]
    assert user["username"].startswith("道友") and user["role"] == "player"
    assert user["email"] == email and user["hasPassword"] is False
    assert "frx_session" in s.client.cookies
    assert counts(s) == (2, 1, 1)
    assert s.client.get(ACCOUNT).json()["user"] == user
    assert s.client.post(ACCOUNT + "/password", json={
        "oldPassword": "any-password", "newPassword": "new-password"}).status_code == 403
    again = s.client.post(ACCOUNT + "/email/login", json={"email": email, "code": code})
    assert again.status_code == 401 and counts(s) == (2, 1, 1)
    s.client.post(ACCOUNT + "/logout")
    s.time.now += 60
    code = code_for(s)
    existing = s.client.post(ACCOUNT + "/email/login", json={"email": email, "code": code})
    assert existing.json()["user"]["id"] == user["id"]
    assert counts(s) == (2, 1, 1)


@pytest.mark.parametrize("raw,expected", [
    (" Alice+Quest@EXAMPLE.com ", "alice+quest@example.com"),
    ("a.b@例子.测试", "a.b@xn--fsqu00a.xn--0zwm56d"),
    ("one_two@sub.example.com", "one_two@sub.example.com"),
])
def test_email_normalization_preserves_local_name_dots_and_tags(raw, expected):
    assert normalize_email(raw) == expected


@pytest.mark.parametrize("email", [
    "a@example.com\r\nBcc:x@example.com", "a@example.com\n", "Alice <a@example.com>",
    "a..b@example.com", ".a@example.com", "a.@example.com", "修仙@example.com",
    "a b@example.com", "a@b@c.com", "a@-example.com", "a@example.com.",
    "a" * 65 + "@example.com", "a@" + "b" * 64 + ".com", "a@localhost",
    "a@" + ".".join(["b" * 63] * 4),
])
def test_unsafe_or_overlong_mailboxes_are_rejected(email):
    with pytest.raises(PlayError) as rejected:
        normalize_email(email)
    assert rejected.value.status == 422


def test_resending_invalidates_the_previous_code_and_expiry_is_enforced(email_server, monkeypatch):
    s = email_server
    draws = iter([123456, 123456, 123456, 654321])
    monkeypatch.setattr("frx.email_login.secrets.randbelow", lambda _: next(draws))
    first = code_for(s)
    early = failure(lambda: code_for(s))
    assert early.status == 429 and early.headers["Retry-After"] == "60"
    s.time.now += 60
    second = code_for(s)
    assert first == "123456" and second == "654321"
    assert failure(lambda: s.email.login("player@example.com", first, "a")).status == 401
    s.time.now += 600
    assert failure(lambda: s.email.login("player@example.com", second, "a")).status == 401
    assert counts(s) == (1, 0, 0)


def test_five_failures_disable_one_code_and_resending_does_not_reset_the_ip_budget(email_server):
    s = email_server
    for cycle in range(IP_FAILURE_LIMIT // CODE_FAILURE_LIMIT):
        if cycle:
            s.time.now += 60
        code = code_for(s, address="attacker")
        wrong = "000001" if code == "000000" else "000000"
        for _ in range(CODE_FAILURE_LIMIT):
            rejected = failure(lambda: s.email.login("player@example.com", wrong, "attacker"))
            assert rejected.status == 401
        with s.store.sessions() as session:
            assert session.get(EmailLoginChallenge, "player@example.com").status == "failed"
    s.time.now += 60
    code = code_for(s, address="attacker")
    denied = failure(lambda: s.email.login("player@example.com", code, "attacker"))
    assert denied.status == 429 and int(denied.headers["Retry-After"]) > 0
    assert counts(s) == (1, 0, 0)
    with s.store.sessions() as session:
        budget = session.get(EmailIPLimit, s.email.address_key("attacker"))
        assert budget.failures == IP_FAILURE_LIMIT


def test_email_and_ip_hourly_send_limits_are_independent(email_server):
    s = email_server
    for _ in range(EMAIL_SEND_LIMIT):
        code_for(s, address="one")
        s.time.now += 60
    assert failure(lambda: code_for(s, address="another")).status == 429
    for number in range(IP_SEND_LIMIT):
        code_for(s, f"player{number}@example.com", "bulk")
    denied = failure(lambda: code_for(s, "one-more@example.com", "bulk"))
    assert denied.status == 429
    assert counts(s) == (1, 0, 0)
    s.time.now += 3600
    assert code_for(s, "one-more@example.com", "bulk")


def test_smtp_failure_is_sanitized_and_cannot_create_an_account_or_session(email_server):
    s = email_server
    s.mailer.fail = True
    result = s.client.post(ACCOUNT + "/email/code", json={"email": "player@example.com"})
    assert result.status_code == 503 and result.json()["error"]["code"] == "email_unavailable"
    assert "private" not in result.text and "smtp" not in result.text
    code = s.mailer.messages[-1][1]
    assert s.client.post(ACCOUNT + "/email/login", json={
        "email": "player@example.com", "code": code}).status_code == 401
    assert counts(s) == (1, 0, 0) and "frx_session" not in s.client.cookies
    with s.store.sessions() as session:
        assert session.get(EmailLoginChallenge, "player@example.com").status == "failed"
        assert session.get(EmailSendLimit, "player@example.com").sent == 1
    assert s.client.post(ACCOUNT + "/email/code", json={
        "email": "player@example.com"}).status_code == 429


@pytest.mark.parametrize("late_failure", [False, True])
def test_pending_delivery_is_unusable_and_late_delivery_cannot_replace_a_new_code(
    email_server, monkeypatch, late_failure,
):
    s = email_server
    entered, release = threading.Event(), threading.Event()
    send = s.mailer.send_code

    def delayed(email, code):
        send(email, code)
        if len(s.mailer.messages) == 1:
            entered.set()
            assert release.wait(5)
            if late_failure:
                raise RuntimeError("late delivery failure")

    monkeypatch.setattr(s.mailer, "send_code", delayed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(failure, lambda: code_for(s))
        try:
            assert entered.wait(5)
            old_code = s.mailer.messages[0][1]
            assert failure(lambda: s.email.login("player@example.com", old_code, "a")).status == 401
            s.time.now += 60
            current = code_for(s)
        finally:
            release.set()
        first.result(timeout=5)
    with s.store.sessions() as session:
        assert session.get(EmailLoginChallenge, "player@example.com").status == "delivered"
    user, _ = s.email.login("player@example.com", current, "a")
    assert user.role == "player" and counts(s) == (2, 1, 1)


def test_concurrent_code_consumption_creates_exactly_one_user_and_session(email_server):
    s = email_server
    code = code_for(s)
    start = threading.Barrier(2)

    def login():
        start.wait(timeout=5)
        return failure(lambda: s.email.login("player@example.com", code, "same-browser"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: login(), range(2)))
    assert sum(isinstance(result, tuple) for result in results) == 1
    assert [result.status for result in results if isinstance(result, PlayError)] == [401]
    assert counts(s) == (2, 1, 1)


def test_concurrent_sends_cannot_bypass_the_resend_cooldown(email_server):
    s = email_server
    start = threading.Barrier(2)

    def send():
        start.wait(timeout=5)
        return failure(lambda: code_for(s))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert sum(isinstance(result, str) for result in results) == 1
    assert [result.status for result in results if isinstance(result, PlayError)] == [429]
    assert len(s.mailer.messages) == 1


def test_a_code_that_expires_while_waiting_for_its_lock_is_not_accepted(email_server, monkeypatch):
    s = email_server
    code = code_for(s)
    entered = threading.Event()
    original_lock = s.email.lock

    def waiting_lock(session, email, address_hash=None):
        entered.set()
        original_lock(session, email, address_hash)

    monkeypatch.setattr(s.email, "lock", waiting_lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with s.accounts.sessions.begin() as session:
            original_lock(session, "player@example.com", s.email.address_key("a"))
            waiting = pool.submit(failure, lambda: s.email.login("player@example.com", code, "a"))
            assert entered.wait(5)
            s.time.now += 601
        assert waiting.result(timeout=5).status == 401
    assert counts(s) == (1, 0, 0)


def test_closed_registration_keeps_existing_email_login_and_rechecks_after_delivery(email_server):
    s = email_server
    code = code_for(s)
    s.accounts.registration = "closed"
    assert failure(lambda: s.email.login("player@example.com", code, "a")).status == 403
    assert counts(s) == (1, 0, 0)
    assert failure(lambda: code_for(s, "new@example.com")).status == 403
    s.accounts.registration = "invite"
    existing, _ = s.email.login("player@example.com", code, "a")
    s.accounts.registration = "closed"
    s.time.now += 60
    code = code_for(s)
    logged_in, _ = s.email.login("player@example.com", code, "a")
    assert logged_in.id == existing.id
    options = s.client.get(ACCOUNT + "/options").json()
    assert options["emailLogin"] is True and options["emailRegistration"] is False


def test_disabled_email_account_cannot_login_or_be_replaced(email_server):
    s = email_server
    user, _ = s.email.login("player@example.com", code_for(s), "a")
    with s.store.sessions.begin() as session:
        session.get(UserRecord, user.id).status = "disabled"
    s.time.now += 60
    code = code_for(s)
    denied = failure(lambda: s.email.login("PLAYER@example.com", code, "a"))
    assert denied.status == 403 and counts(s) == (2, 1, 1)
    with s.store.sessions() as session:
        assert session.get(EmailIdentity, user.id).email == "player@example.com"


def test_account_deletion_removes_email_identity_and_codes_but_keeps_send_budget(email_server):
    s = email_server
    user, _ = s.email.login("player@example.com", code_for(s), "a")
    s.time.now += 60
    code_for(s)
    result = Admin(s.store.engine).delete_user(user.username)
    assert result["rows"]["email_identities"] == 1 and counts(s) == (1, 0, 0)
    with s.store.sessions() as session:
        assert session.get(EmailLoginChallenge, "player@example.com") is None
        assert session.get(EmailSendLimit, "player@example.com").sent == 2


def test_missing_mail_configuration_leaves_password_options_unchanged(email_server):
    s = email_server
    s.mailer.configured = False
    assert s.client.get(ACCOUNT + "/options").json() == {
        "mode": "accounts", "registration": "invite"}
    assert s.client.post(ACCOUNT + "/email/code", json={
        "email": "player@example.com"}).status_code == 503
    assert not s.mailer.messages


def test_email_models_are_real_tables_with_a_cascading_unique_identity(email_server):
    s = email_server
    one, _ = s.email.login("one@example.com", code_for(s, "one@example.com"), "a")
    two, _ = s.email.login("two@example.com", code_for(s, "two@example.com"), "a")
    assert one.username != two.username
    assert "one@" not in one.username and "two@" not in two.username
    with s.store.engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM email_identities")).scalar() == 2
        assert connection.execute(text("SELECT COUNT(*) FROM email_login_challenges")).scalar() == 2
