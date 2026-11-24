"""Shared fixtures. PostgreSQL tests need FRX_TEST_PG_URL (a throwaway instance, never the main
service's database); each test gets its own temporary database there and drops it afterwards."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


@pytest.fixture
def cheap_passwords(monkeypatch):
    """argon2id with its smallest parameters, so tests that sign in many times stay quick;
    tests/test_auth.py checks the parameters the server really uses."""
    from argon2 import PasswordHasher
    from frx import auth

    cheap = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    monkeypatch.setattr(auth, "PASSWORDS", cheap)
    monkeypatch.setattr(auth, "_DUMMY", None)


@pytest.fixture
def pg_url():
    base = os.getenv("FRX_TEST_PG_URL")
    if not base:
        pytest.skip("FRX_TEST_PG_URL 未设置，跳过需要 PostgreSQL 的测试")
    url = make_url(base)
    if url.port == 55432:
        pytest.fail("FRX_TEST_PG_URL 指向主服务的数据库端口 55432，测试拒绝运行")
    name = "frx_test_" + uuid4().hex[:12]
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def server_role_sql(role, password, database, owner):
    """The statements of the deployment's role script (deploy/postgres/10-app-role.sh) for a
    role of this name, password, database and owner."""
    import re

    from frx.domain import ROOT

    script = (ROOT / "deploy/postgres/10-app-role.sh").read_text()
    sql = re.search(r"<<'SQL'\n(.*?)\nSQL", script, re.S)[1]
    sql = (sql.replace("frx_app", role).replace(":'app_password'", f"'{password}'")
           .replace(':"db"', f'"{database}"').replace(':"owner"', f'"{owner}"'))
    return [statement for statement in sql.split(";") if statement.strip()]


@pytest.fixture
def pg_server_role(pg_url):
    """The multi-user deployment's two roles in the test database, before any table exists:
    the owner (the instance's own user, who builds the schema) and the server's low-privilege
    role, made by the deployment's own script under a name of its own. Use it before the schema
    is built, as the deployment does. SimpleNamespace(owner=url, server=url, role=name)."""
    from types import SimpleNamespace

    url = make_url(pg_url)
    role = "frx_test_app_" + uuid4().hex[:8]
    password = uuid4().hex
    owner = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    with owner.connect() as connection:
        for statement in server_role_sql(role, password, url.database, url.username):
            connection.execute(text(statement))
    try:
        yield SimpleNamespace(
            owner=pg_url,
            server=url.set(username=role, password=password).render_as_string(
                hide_password=False),
            role=role,
        )
    finally:
        with owner.connect() as connection:
            connection.execute(text(f"DROP OWNED BY {role}"))
        owner.dispose()
        admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
            connection.execute(text(f"DROP ROLE IF EXISTS {role}"))
        admin.dispose()
