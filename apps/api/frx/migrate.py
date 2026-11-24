"""Create or inspect the domain schema. Previous database layouts are deliberately unsupported.

Use ``python -m frx.migrate status|upgrade|digests --url URL``. A database URL is always explicit.
An existing pre-domain database is refused without changes; this command never clears a database.
"""

import argparse
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, inspect, select, text

HEAD = "domain_0001"
SCRIPTS = "frx:migrations"
INCOMPATIBLE = "此数据库使用不支持的旧结构；请配置一个全新的空数据库，不会迁移或清空旧数据"


def metadata():
    from . import auth, card_media, card_store, email_login, play_places, save_schema, usage  # noqa: F401
    from .storage import Base

    return Base.metadata


def schema_state(connection):
    tables = set(inspect(connection).get_table_names())
    if not tables:
        return "fresh"
    if "card_records" in tables or any(name.endswith("_pre_accounts") for name in tables):
        return "unsupported"
    if "alembic_version" in tables:
        versions = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalars().all()
        if versions == [HEAD]:
            required = set(metadata().tables)
            if required <= tables:
                return HEAD
            return "incomplete"
        if versions:
            return versions[0] if len(versions) == 1 else "unsupported"
        if tables == {"alembic_version"}:
            return "fresh"
    return "unsupported"


def alembic_config(connection, data_dir=None):
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", SCRIPTS)
    config.attributes["connection"] = connection
    return config


@contextmanager
def transaction(engine):
    """Schema creation and the version record commit atomically, including SQLite DDL."""
    with engine.connect() as connection, connection.begin():
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        elif connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('frx-domain-schema'))"))
        yield connection


def create_baseline(connection):
    """Create only into an empty database; no import or legacy migration path exists."""
    existing = set(inspect(connection).get_table_names()) - {"alembic_version"}
    if existing:
        raise RuntimeError(INCOMPATIBLE)
    from .auth import UserRecord, local_user_row
    from .storage import rls_statements

    metadata().create_all(connection)
    connection.execute(UserRecord.__table__.insert(), [local_user_row()])
    if connection.dialect.name == "postgresql":
        for statement in rls_statements():
            connection.execute(text(statement))


def bring_to_head(engine, data_dir=None):
    with transaction(engine) as connection:
        state = schema_state(connection)
        if state == HEAD:
            return state
        if state != "fresh":
            raise RuntimeError(INCOMPATIBLE)
        create_baseline(connection)
        stamp(connection)
        return state


def stamp(connection):
    connection.execute(text(
        "CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL, "
        "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
    ))
    connection.execute(text("DELETE FROM alembic_version"))
    connection.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": HEAD})


def digests(connection):
    """Current domain table counts, plus the content digests of each save."""
    from sqlalchemy.orm import Session

    from .save_schema import Archive, encoded

    state = schema_state(connection)
    if state == "fresh":
        return {"state": state, "counts": {}, "saves": {}}
    if state != HEAD:
        raise RuntimeError(INCOMPATIBLE)
    counts = {name: connection.execute(text(f'SELECT COUNT(*) FROM "{name}"')).scalar()
              for name in sorted(metadata().tables)}
    import hashlib

    with Session(bind=connection) as session:
        saves = {row.user_id + "/" + row.archive_id:
                 hashlib.sha256(encoded(row.value).encode()).hexdigest()
                 for row in session.scalars(select(Archive).where(Archive.deleted.is_(False)))}
    return {"state": state, "counts": counts, "saves": dict(sorted(saves.items()))}


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m frx.migrate", description=__doc__.split("\n")[0]
    )
    parser.add_argument("command", choices=["status", "upgrade", "digests"])
    parser.add_argument("--url", required=True, help="数据库连接串，必须明确给出")
    parser.add_argument("--data-dir", help="数据目录")
    args = parser.parse_args(argv)
    if args.data_dir:
        os.environ["FRX_DATA_DIR"] = str(Path(args.data_dir))
    engine = create_engine(args.url)
    try:
        if args.command == "upgrade":
            before = bring_to_head(engine)
            print(json.dumps({"before": before, "now": HEAD}, ensure_ascii=False))
        else:
            with engine.connect() as connection:
                print(schema_state(connection) if args.command == "status"
                      else json.dumps(digests(connection), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
