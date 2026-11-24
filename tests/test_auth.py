"""Accounts, passwords, sessions and access levels (accounts plan A-1 to A-8, I-9, U-7, P-2).

A multi-user server (FRX_AUTH=on) over a temporary SQLite database, driven through the account
routes the login page uses (/api/play/account/*). Passwords are made up for each run and never
written down; argon2id runs with its smallest parameters except where the real ones are checked.
"""

import re
import secrets
import time
from types import SimpleNamespace

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from frx import auth
from frx.auth import (
    LEVELS,
    InviteRecord,
    SessionRecord,
    UserRecord,
    hash_password,
    invite_hash,
    new_invite_code,
)
from frx.gateway import ModelSettings
from frx.main import create_app
from frx.storage import Store
from sqlalchemy import event, inspect, select, text
from starlette.routing import Mount

LOCAL = {"X-FRX-Client": "local"}
ACCOUNT = "/api/play/account"
MODEL_ADDRESS = "http://127.0.0.1:9/v1"


def made_up():
    return "pw-" + secrets.token_urlsafe(12)


@pytest.fixture(params=["sqlite", "postgresql"])
def server(request, tmp_path, monkeypatch, cheap_passwords):
    """A multi-user server. On PostgreSQL it connects as the deployment's low-privilege role;
    `store` is the owner's connection, for setting up and looking at every row."""
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FRX_AUTH", "on")
    for name in ("FRX_REGISTRATION", "FRX_TRUSTED_PROXIES", "FRX_ALLOWED_HOSTS", "FRX_LAN"):
        monkeypatch.delenv(name, raising=False)
    # A model service nobody listens at: a call fails at once, and the connection is the
    # environment's, so no route can change it under the test.
    monkeypatch.setenv("FRX_API_BASE", MODEL_ADDRESS)
    monkeypatch.setenv("FRX_MODEL", "fixture-model")
    if request.param == "sqlite":
        store = served = Store("sqlite:///" + str(tmp_path / "accounts.db"))
    else:
        roles = request.getfixturevalue("pg_server_role")
        monkeypatch.setenv("FRX_MIGRATION_URL", roles.owner)
        store, served = Store(roles.owner), Store(roles.server)
        store.initialize()
    settings = ModelSettings(tmp_path / "model.json")
    app = create_app(store=served, settings=settings)
    with TestClient(app, headers=LOCAL) as client:
        yield SimpleNamespace(app=app, store=store, client=client, backend=request.param,
                              accounts=app.state.accounts)
    served.engine.dispose()
    store.engine.dispose()


def browser(server, **kwargs):
    """Another browser: its own cookies."""
    return TestClient(server.app, headers=LOCAL, **kwargs)


def invite(server, expires_at=None):
    code = new_invite_code()
    with server.store.sessions.begin() as session:
        session.add(InviteRecord(code_hash=invite_hash(code), created_at=time.time(),
                                 expires_at=expires_at))
    return code


def register(client, name, word, code):
    return client.post(ACCOUNT + "/register", json={
        "username": name, "password": word, "invite": code})


def sign_in(client, name, word):
    return client.post(ACCOUNT + "/login", json={"username": name, "password": word})


def player(server, name="lin_yan"):
    """A registered player: (browser signed in, password)."""
    word = made_up()
    client = browser(server)
    assert register(client, name, word, invite(server)).status_code == 201
    return client, word


def add_admin(server, name="keeper"):
    word = made_up()
    with server.store.sessions.begin() as session:
        session.add(UserRecord(id="admin-" + name, username=name, username_key=name.casefold(),
                               password_hash=hash_password(word), role="admin", status="active",
                               created_at="2026-11-12T00:00:00+00:00"))
    client = browser(server)
    assert sign_in(client, name, word).status_code == 200
    return client


def code_of(response):
    return response.json()["error"]["code"]


# ---------------------------------------------------------------------- A-1 registration


def test_a_valid_invite_registers_and_signs_in(server):
    client = browser(server)
    code = invite(server)
    word = made_up()
    created = register(client, "林砚-01", word, code.lower().replace("-", " "))
    assert created.status_code == 201, created.text
    account = created.json()
    assert account["mode"] == "accounts"
    assert account["user"]["username"] == "林砚-01" and account["user"]["role"] == "player"
    assert account["limits"]["turns"] == 200 and account["limits"]["cost"] == 3
    assert account["usage"]["calls"] == 0
    assert client.get(ACCOUNT).json()["user"]["id"] == account["user"]["id"]
    # The code is spent.
    again = register(browser(server), "another", made_up(), code)
    assert again.status_code == 422 and code_of(again) == "invalid_input"


def test_invalid_expired_and_used_codes_are_refused(server):
    for code in ("ABCD-EFGH-JKMN-PQRS", invite(server, expires_at=time.time() - 1), ""):
        refused = register(browser(server), "newcomer", made_up(), code)
        assert refused.status_code == 422 and code_of(refused) == "invalid_input", refused.text
    with server.store.sessions() as session:
        assert session.scalar(select(UserRecord).where(UserRecord.username == "newcomer")) is None
    later = invite(server, expires_at=time.time() + 3600)
    assert register(browser(server), "newcomer", made_up(), later).status_code == 201


def test_closed_and_open_registration(server, monkeypatch):
    server.accounts.registration = "closed"
    closed = register(browser(server), "newcomer", made_up(), invite(server))
    assert closed.status_code == 403 and code_of(closed) == "forbidden"
    assert server.client.get(ACCOUNT + "/options").json() == {
        "mode": "accounts", "registration": "closed"}
    server.accounts.registration = "open"
    assert register(browser(server), "newcomer", made_up(), None).status_code == 201


@pytest.mark.parametrize("name", ["ab", "x" * 25, "有 空格", "a/b", "local", "LOCAL", "名字!"])
def test_names_outside_the_rules_are_refused(server, name):
    refused = register(browser(server), name, made_up(), invite(server))
    assert refused.status_code == 422 and code_of(refused) == "invalid_input"


def test_password_rules(server):
    for word in ("short7!", "x" * 129, "Same_Name"):
        refused = register(browser(server), "same_name", word, invite(server))
        assert refused.status_code == 422 and code_of(refused) == "invalid_input", word
    accepted = register(browser(server), "same_name", "八个字的密码不难记", invite(server))
    assert accepted.status_code == 201


# ---------------------------------------------------------------------- A-2 signing in


def test_signing_in_with_the_right_name_and_password(server):
    _, word = player(server, "Lin_Yan")
    client = browser(server)
    signed = sign_in(client, "lin_yan", word)  # names compare without case
    assert signed.status_code == 200 and signed.json()["user"]["username"] == "Lin_Yan"
    assert client.get("/api/play/saves").status_code == 200
    wrong = sign_in(browser(server), "Lin_Yan", word + "x")
    nobody = sign_in(browser(server), "nobody_here", word)
    assert wrong.status_code == nobody.status_code == 401
    assert wrong.json() == nobody.json() == {
        "error": {"code": "unauthorized", "message": "用户名或密码不对"}}
    # A name differing only in case is taken (越权清单).
    taken = register(browser(server), "LIN_YAN", made_up(), invite(server))
    assert taken.status_code == 422 and "已经有人用了" in taken.json()["error"]["message"]


def test_every_sign_in_gets_a_new_token(server):
    _, word = player(server)
    first, second = browser(server), browser(server)
    sign_in(first, "lin_yan", word)
    sign_in(second, "lin_yan", word)
    assert first.cookies["frx_session"] != second.cookies["frx_session"]


def test_the_unclaimed_local_player_cannot_sign_in(server):
    refused = sign_in(browser(server), "local", "")
    assert refused.status_code == 401


# ---------------------------------------------------------------------- A-3 sessions ending


def test_logging_out_ends_the_session(server):
    client, _ = player(server)
    token = client.cookies["frx_session"]
    out = client.post(ACCOUNT + "/logout")
    assert out.status_code == 204
    assert 'frx_session=""' in out.headers["set-cookie"] or "Max-Age=0" in out.headers[
        "set-cookie"]
    stale = browser(server, cookies={"frx_session": token})
    refused = stale.get("/api/play/saves")
    assert refused.status_code == 401 and code_of(refused) == "unauthorized"


def test_a_session_ends_after_thirty_days_without_activity(server):
    client, _ = player(server)
    assert client.get("/api/play/saves").status_code == 200
    start = time.time()
    server.accounts.clock = lambda: start + 29 * 86400
    assert client.get("/api/play/saves").status_code == 200  # activity moves the expiry on
    server.accounts.clock = lambda: start + 29 * 86400 + 31 * 86400
    refused = client.get("/api/play/saves")
    assert refused.status_code == 401
    assert "frx_session" in refused.headers.get("set-cookie", "")  # the browser drops it


def test_activity_is_written_at_most_every_ten_minutes(server):
    client, _ = player(server)
    token = client.cookies["frx_session"]
    with server.store.sessions() as session:
        row = session.scalars(select(SessionRecord)).one()
        seen = row.last_seen_at
    start = time.time()
    server.accounts.clock = lambda: start + 300
    client.get("/api/play/saves")
    with server.store.sessions() as session:
        assert session.get(SessionRecord, auth.token_hash(token)).last_seen_at == seen
    server.accounts.clock = lambda: start + 700
    renewed = client.get("/api/play/saves")
    assert "frx_session=" in renewed.headers["set-cookie"]
    with server.store.sessions() as session:
        row = session.get(SessionRecord, auth.token_hash(token))
        assert row.last_seen_at == start + 700
        assert row.expires_at == start + 700 + 30 * 86400


def test_changing_the_password_ends_the_other_sessions(server):
    client, word = player(server)
    other = browser(server)
    sign_in(other, "lin_yan", word)
    new = made_up()
    wrong = client.post(ACCOUNT + "/password", json={"oldPassword": word + "x",
                                                      "newPassword": new})
    assert wrong.status_code == 422 and code_of(wrong) == "invalid_input"
    changed = client.post(ACCOUNT + "/password", json={"oldPassword": word, "newPassword": new})
    assert changed.status_code == 204, changed.text
    assert client.get("/api/play/saves").status_code == 200
    assert other.get("/api/play/saves").status_code == 401
    assert sign_in(browser(server), "lin_yan", word).status_code == 401
    assert sign_in(browser(server), "lin_yan", new).status_code == 200


def test_a_disabled_account_loses_every_session_and_cannot_sign_in(server):
    from frx.admin import Admin

    client, word = player(server)
    second = browser(server)
    sign_in(second, "lin_yan", word)
    Admin(server.store.engine).disable("lin_yan")
    assert client.get("/api/play/saves").status_code == 401
    assert second.get("/api/play/saves").status_code == 401
    refused = sign_in(browser(server), "lin_yan", word)
    assert refused.status_code == 403 and code_of(refused) == "forbidden"
    Admin(server.store.engine).enable("lin_yan")
    assert sign_in(browser(server), "lin_yan", word).status_code == 200


# ---------------------------------------------------------------------- A-4 the throttle


def test_five_failures_lock_the_name_for_fifteen_minutes(server):
    _, word = player(server)
    start = time.time()
    server.accounts.clock = lambda: start
    for _ in range(5):
        assert sign_in(browser(server), "lin_yan", "wrong-" + made_up()).status_code == 401
    locked = sign_in(browser(server), "lin_yan", word)
    assert locked.status_code == 429 and code_of(locked) == "too_many_attempts"
    assert 800 <= int(locked.headers["retry-after"]) <= 901
    server.accounts.clock = lambda: start + 14 * 60
    assert sign_in(browser(server), "lin_yan", word).status_code == 429
    server.accounts.clock = lambda: start + 15 * 60 + 1
    assert sign_in(browser(server), "lin_yan", word).status_code == 200


def test_five_failures_from_one_address_lock_that_address(server):
    _, word = player(server)
    for number in range(5):
        assert sign_in(browser(server), f"guess_{number}", "x" * 8).status_code == 401
    # The test client always comes from the same address.
    assert sign_in(browser(server), "lin_yan", word).status_code == 429


def test_failures_spread_over_more_than_fifteen_minutes_do_not_lock(server):
    _, word = player(server)
    start = time.time()
    for number in range(8):
        server.accounts.clock = lambda n=number: start + n * 4 * 60
        sign_in(browser(server), "lin_yan", "wrong-" + made_up())
        server.accounts.clock = lambda n=number: start + n * 4 * 60 + 1
        if number % 4 == 3:
            assert sign_in(browser(server), "lin_yan", word).status_code == 200


# ---------------------------------------------------------------------- A-5 nothing in clear


def test_the_database_holds_no_password_and_no_session_token(server):
    client, word = player(server)
    token = client.cookies["frx_session"]
    dump = []
    with server.store.engine.connect() as connection:
        for table in inspect(connection).get_table_names():
            dump += [str(row) for row in connection.execute(text(f'SELECT * FROM "{table}"'))]
    everything = "\n".join(dump)
    assert word not in everything and token not in everything
    assert auth.token_hash(token) in everything
    with server.store.sessions() as session:
        stored = session.scalar(select(UserRecord.password_hash).where(
            UserRecord.username == "lin_yan"))
    assert stored.startswith("$argon2id$")


def test_the_server_hashes_with_argon2id_defaults(monkeypatch):
    monkeypatch.setattr(auth, "PASSWORDS", None)
    hashed = auth.hash_password(made_up())
    assert re.match(r"^\$argon2id\$v=19\$m=65536,t=3,p=4\$", hashed)


# ---------------------------------------------------------------------- A-6 the cookie


def cookie_flags(response):
    header = response.headers["set-cookie"]
    return header, {part.strip().split("=")[0].lower() for part in header.split(";")}


def test_the_cookie_is_httponly_and_samesite_lax_and_secure_under_https(server):
    client = browser(server)
    _, word = player(server)
    header, flags = cookie_flags(sign_in(client, "lin_yan", word))
    assert header.startswith("frx_session=")
    assert {"httponly", "samesite", "path", "max-age"} <= flags and "secure" not in flags
    assert "samesite=lax" in header.lower()
    secure = TestClient(server.app, base_url="https://testserver", headers=LOCAL)
    _, flags = cookie_flags(sign_in(secure, "lin_yan", word))
    assert "secure" in flags


@pytest.mark.usefixtures("cheap_passwords")
def test_behind_a_trusted_proxy_the_forwarded_https_counts(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FRX_AUTH", "on")
    monkeypatch.setenv("FRX_REGISTRATION", "open")
    monkeypatch.setenv("FRX_TRUSTED_PROXIES", "testclient")
    store = Store("sqlite:///" + str(tmp_path / "proxy.db"))
    app = create_app(store=store, settings=ModelSettings(tmp_path / "m.json"))
    forwarded = {**LOCAL, "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.9"}
    word = made_up()
    with TestClient(app, headers=forwarded) as client:
        created = register(client, "proxied", word, None)
        assert created.status_code == 201
        _, flags = cookie_flags(created)
        assert "secure" in flags
        # The same-origin check sees the browser's https origin, not the proxy's http.
        signed = client.post(ACCOUNT + "/login", headers={"Origin": "https://testserver"},
                             json={"username": "proxied", "password": word})
        assert signed.status_code == 200
        plain = client.post(ACCOUNT + "/login", headers={"Origin": "http://testserver"},
                            json={"username": "proxied", "password": word})
        assert plain.status_code == 403
        # The throttle counts the browser's address, not the proxy's.
        for _ in range(5):
            client.post(ACCOUNT + "/login", json={"username": "proxied", "password": "x" * 9})
        with store.sessions() as session:
            keys = set(session.scalars(text("SELECT key FROM login_throttle")).all())
        assert "addr:203.0.113.9" in keys
    store.engine.dispose()
    # An untrusted sender's forwarded protocol is ignored.
    monkeypatch.setenv("FRX_TRUSTED_PROXIES", "10.9.9.9")
    store = Store("sqlite:///" + str(tmp_path / "proxy2.db"))
    app = create_app(store=store, settings=ModelSettings(tmp_path / "m.json"))
    with TestClient(app, headers=forwarded) as client:
        _, flags = cookie_flags(register(client, "direct", made_up(), None))
        assert "secure" not in flags
    store.engine.dispose()


# ---------------------------------------------------------------------- A-7 cross-site writes


def test_writes_without_the_header_or_from_another_origin_are_refused(server):
    _, word = player(server)
    body = {"username": "lin_yan", "password": word}
    bare = TestClient(server.app)
    for response in (
        bare.post(ACCOUNT + "/login", json=body),
        bare.post(ACCOUNT + "/register", json={**body, "invite": invite(server)}),
        browser(server).post(ACCOUNT + "/login", json=body,
                             headers={"Origin": "https://evil.example"}),
    ):
        assert response.status_code == 403 and code_of(response) == "forbidden"
    # A signed-in browser's write needs the header too.
    client = browser(server)
    sign_in(client, "lin_yan", word)
    stolen = TestClient(server.app, cookies={"frx_session": client.cookies["frx_session"]})
    refused = stolen.put("/api/play/settings", json={"standingNote": "x"})
    assert refused.status_code == 403


# ---------------------------------------------------------------------- A-8 access levels

PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/play/account/options"),
    ("POST", "/api/play/account/login"),
    ("POST", "/api/play/account/email/code"),
    ("POST", "/api/play/account/email/login"),
    ("POST", "/api/play/account/register"),
    ("GET", "/"),
    ("GET", "/play"),
    ("GET", "/play/"),
    # the tab icon browsers ask for on their own, like the interface's art: no player data
    ("GET", "/favicon.ico"),
}
ADMIN_PLAY = {
    ("PUT", "/api/play/connection"),
    ("PUT", "/api/play/profiles/{name}"),
    ("GET", "/api/play/profiles/{name}/models"),
    ("POST", "/api/play/profiles/{name}/check"),
}
# Routes served as files: the new interface's build and art (the login page is in it).
MOUNTS = {"/play/assets", "/play"}


def level_of(route):
    """The route's access level: the dependencies frx.auth marks the levels with."""
    found = [LEVELS[d.dependency] for d in route.dependencies if d.dependency in LEVELS]
    assert found in (["public"], ["login"], ["admin"], ["login", "admin"]), (
        route.path, route.methods, found)
    return found[-1]


def api_routes(routes, prefix="", dependencies=()):
    """Every APIRoute, with what an include adds (FastAPI keeps included routers whole)."""
    for route in routes:
        included = getattr(route, "original_router", None)
        if included is not None:
            context = route.include_context
            yield from api_routes(included.routes, prefix + context.prefix,
                                  (*dependencies, *context.dependencies))
        elif isinstance(route, APIRoute):
            if dependencies:
                route = SimpleNamespace(path=route.path, methods=route.methods,
                                        dependencies=[*dependencies, *route.dependencies])
            yield prefix, route


def routes_of(app):
    for prefix, route in api_routes(app.routes):
        for method in route.methods:
            yield method, prefix + route.path, route


def test_every_route_has_an_access_level(server):
    levels = {(method, path): level_of(route) for method, path, route in routes_of(server.app)}
    assert len(levels) > 40
    public = {key for key, level in levels.items() if level == "public"}
    # GET /play/ is a route only while the new interface is not built (a mount after).
    assert PUBLIC - {("GET", "/play/")} <= public <= PUBLIC
    admins = {key for key, level in levels.items() if level == "admin"}
    assert admins == ADMIN_PLAY
    # Everything else under /api/play needs a signed-in user.
    play = {key for key in levels if key[1].startswith("/api/play")}
    assert play - PUBLIC - admins and all(
        levels[key] == "login" for key in play - PUBLIC - admins)
    mounts = {route.path for route in server.app.routes if isinstance(route, Mount)}
    assert mounts <= MOUNTS


def test_the_calendar_of_a_save_is_for_a_signed_in_player(server):
    """Gameplay plan item 14: the calendar of a save in the cultivation life is the player's own,
    like the save's state."""
    levels = {(method, path): level_of(route) for method, path, route in routes_of(server.app)}
    assert levels[("GET", "/api/play/saves/{archive_id}/calendar")] == "login"
    assert levels[("GET", "/api/play/saves/{archive_id}/state")] == "login"
    # item 35: the notices and the shop of the save's place
    assert levels[("GET", "/api/play/saves/{archive_id}/notices")] == "login"
    assert levels[("GET", "/api/play/saves/{archive_id}/shop")] == "login"
    # item 38: the book's volumes and chapters
    assert levels[("GET", "/api/play/saves/{archive_id}/book")] == "login"


def filled(path):
    return re.sub(r"\{[^}]+\}", "x0", path)


def test_without_a_session_every_login_route_answers_401(server):
    anonymous = TestClient(server.app, headers=LOCAL)
    checked = 0
    for method, path, route in routes_of(server.app):
        if level_of(route) == "public":
            continue
        response = anonymous.request(method, filled(path), json={})
        assert response.status_code == 401, (method, path, response.text)
        assert response.json() == {"error": {"code": "unauthorized", "message": "请先登录"}}
        checked += 1
    assert checked > 35


def test_a_player_gets_403_from_every_admin_route_and_an_admin_does_not(server):
    client, _ = player(server)
    keeper = add_admin(server)
    for method, path, route in routes_of(server.app):
        if level_of(route) != "admin":
            continue
        refused = client.request(method, filled(path), json={})
        assert refused.status_code == 403, (method, path, refused.text)
        assert code_of(refused) == "forbidden"
        allowed = keeper.request(method, filled(path), json={})
        assert allowed.status_code not in (401, 403), (method, path, allowed.text)


def test_players_see_no_model_address(server):
    """I-9 and U-7: the model's address is the administrators'; players change nothing."""
    client, _ = player(server)
    keeper = add_admin(server)
    mine = client.get("/api/play/connection").json()
    assert mine == {"model": "fixture-model", "configured": True}
    assert keeper.get("/api/play/connection").json()["base_url"] == MODEL_ADDRESS
    profiles = client.get("/api/play/profiles").text
    assert "127.0.0.1:9" not in profiles
    change = {"base_url": "https://elsewhere.example/v1", "model": "x"}
    assert client.put("/api/play/connection", json=change).status_code == 403
    assert client.put("/api/play/profiles/summary", json={"model": "x"}).status_code == 403
    assert keeper.put("/api/play/profiles/summary", json={"model": "x"}).status_code == 200


def test_the_api_description_is_not_published(server):
    assert server.client.get("/openapi.json").status_code == 404
    assert server.client.get("/docs").status_code == 404


def test_the_front_door_leads_to_the_new_interface(server):
    assert server.client.get("/", follow_redirects=False).headers["location"] == "/play/"


# ---------------------------------------------------------------------- P-2 one query


def test_a_signed_in_request_costs_one_query_more_than_in_local_mode(server, tmp_path,
                                                                     monkeypatch):
    if server.backend != "sqlite":
        pytest.skip("compared with a local server on the same kind of database (SQLite)")
    client, _ = player(server)
    client.get("/api/play/settings")

    def count(app_client, store):
        statements = []

        def seen(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(store.engine, "before_cursor_execute", seen)
        try:
            assert app_client.get("/api/play/settings").status_code == 200
        finally:
            event.remove(store.engine, "before_cursor_execute", seen)
        return len(statements)

    signed = count(client, server.store)
    monkeypatch.setenv("FRX_AUTH", "off")
    local_store = Store("sqlite:///" + str(tmp_path / "local.db"))
    local_app = create_app(store=local_store, settings=ModelSettings(tmp_path / "m.json"))
    with TestClient(local_app, headers=LOCAL) as local:
        local.get("/api/play/settings")
        alone = count(local, local_store)
    local_store.engine.dispose()
    assert signed - alone <= 1, (signed, alone)


# ---------------------------------------------------------------------- local mode


def test_local_mode_has_no_login(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FRX_AUTH", "off")
    store = Store("sqlite:///" + str(tmp_path / "local.db"))
    with TestClient(create_app(store=store, settings=ModelSettings(tmp_path / "m.json")),
                    headers=LOCAL) as client:
        assert client.get(ACCOUNT + "/options").json() == {"mode": "local",
                                                           "registration": "closed"}
        account = client.get(ACCOUNT).json()
        assert account["mode"] == "local" and account["user"]["username"] == "local"
        assert account["user"]["role"] == "admin" and account["limits"] == {}
        assert client.get("/api/play/saves").status_code == 200
        word = made_up()
        for path, body in (
            ("/login", {"username": "local", "password": word}),
            ("/register", {"username": "newcomer", "password": word}),
            ("/logout", None),
            ("/password", {"oldPassword": word, "newPassword": made_up()}),
        ):
            refused = client.post(ACCOUNT + path, json=body)
            assert refused.status_code == 403 and code_of(refused) == "forbidden", path
        assert client.get("/", follow_redirects=False).headers["location"] == "/play/"
        assert "set-cookie" not in client.get("/api/play/saves").headers
    store.engine.dispose()
