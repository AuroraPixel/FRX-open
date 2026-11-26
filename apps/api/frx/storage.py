"""The database connection. Transactions stay short; none is held during model calls.

A user's work goes through sessions bound to that user (UserSessions, from bind_user): every
transaction tells PostgreSQL whose rows it may see (row-level security, set up by the migrations
on the tables that hold players' data), and a flush that adds a save or makes one larger is held
to the user's storage limits.
"""

import logging
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)

# The transaction setting PostgreSQL's row-level security policies compare user_id with.
RLS_SETTING = "frx.user_id"
# The tables that hold players' data: each row names its user, and the database shows a
# transaction only the rows of the user it declared (see rls_statements).
RLS_TABLES = (
    "archives", "archive_states", "archive_logs", "snapshots", "log_snapshot_refs",
    "memories", "user_settings", "archive_art", "archive_portraits", "card_requests",
    "user_files", "usage_events", "place_looks",
)


def now() -> str:
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


# How long a write waits for SQLite's single write lock before giving up ("database is
# locked"): the turn's own writes, the work after a turn and usage records take it in turns.
# pysqlite's default is 5 seconds; PostgreSQL has row locks and does not need this.
SQLITE_BUSY_SECONDS = 30


class Store:
    def __init__(self, url: str):
        options = {"timeout": SQLITE_BUSY_SECONDS} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, pool_pre_ping=True, connect_args=options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        if self.engine.dialect.name == "sqlite":
            # Every row names its user; SQLite checks that the user exists only when asked to.
            @event.listens_for(self.engine, "connect")
            def foreign_keys(connection, record):
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

    def initialize(self, migration_url=None):
        """Bring the schema to the latest version (see frx.migrate); returns the state it was
        found in, and says in the log what changed when anything did (the owner checks the
        start of an upgraded server by it).

        `migration_url` is the owner's connection when the server itself connects with a role
        that may not change the schema (the multi-user deployment's FRX_MIGRATION_URL).
        Older database layouts are rejected without modification. There is no legacy migration.
        """
        from .migrate import HEAD, bring_to_head

        started = time.monotonic()
        if not migration_url:
            found = bring_to_head(self.engine)
        else:
            owner = create_engine(migration_url)
            try:
                found = bring_to_head(owner)
            finally:
                owner.dispose()
        if found != HEAD:
            seconds = time.monotonic() - started
            if found == "fresh":
                logger.warning("新库：按表结构版本 %s 建好（%.1f 秒）", HEAD, seconds)
        return found

    def ping(self):
        with self.sessions() as session:
            session.execute(text("select 1"))

    def guard_problem(self):
        """Why the database's own guard (row-level security) does not hold for this server's
        connection, or None when it does: SQLite has none, and PostgreSQL does not hold the
        tables' owner, a superuser or a role that may bypass it to the policies."""
        if self.engine.dialect.name != "postgresql":
            return "数据库是 SQLite，没有行级安全这一道兜底"
        with self.engine.connect() as connection:
            row = connection.execute(text(
                "SELECT r.rolsuper, r.rolbypassrls, t.tableowner = current_user "
                "FROM pg_roles r LEFT JOIN pg_tables t ON t.tablename = 'archives' "
                "AND t.schemaname = current_schema() WHERE r.rolname = current_user"
            )).one()
        if row[0] or row[1]:
            return "服务以超级用户或可绕过行级安全的角色连接数据库，行级安全不起作用"
        if row[2]:
            return "服务以表的属主连接数据库，行级安全对它不起作用"
        return None


# ---------------------------------------------------------------- sessions bound to a user


class UserSessions:
    """A session factory for one user's work, used like a sessionmaker: `sessions()` and
    `sessions.begin()`. Its sessions carry the user and the user's limits in session.info."""

    def __init__(self, sessions, user_id, limits=None):
        if isinstance(sessions, UserSessions):
            sessions = sessions.factory
        self.factory = sessions
        self.user_id = user_id
        self.limits = limits

    def __call__(self, **kwargs):
        session = self.factory(**kwargs)
        session.info["frx_user"] = self.user_id
        session.info["frx_limits"] = self.limits
        return session

    @contextmanager
    def begin(self):
        with self() as session, session.begin():
            yield session


def bind_user(sessions, user_id, limits=None):
    """`sessions` (a sessionmaker or another user's UserSessions) for this user's work."""
    return UserSessions(sessions, user_id, limits)


@event.listens_for(Session, "after_begin")
def _declare_user(session, transaction, connection):
    """Every transaction of a user's session names its user to PostgreSQL, for the row-level
    security policies. The setting is the transaction's own: it ends with the transaction, so a
    pooled connection never carries it to someone else."""
    user = session.info.get("frx_user")
    if user and connection.dialect.name == "postgresql":
        connection.execute(
            text("SELECT set_config(:name, :user, true)"), {"name": RLS_SETTING, "user": user}
        )


@event.listens_for(Session, "after_transaction_end")
def _clear_store_lock(session, transaction):
    if transaction.parent is None:
        session.info.pop("frx_store_lock", None)


def rls_statements():
    """Row-level security on the players' tables: a transaction sees and writes only the rows
    of the user it declared, and none when it declared nobody. The tables' owner (migrations,
    admin commands) is not bound by it; the server's own role in a multi-user deployment is."""
    statements = []
    for table in RLS_TABLES:
        statements += [
            f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY',
            f'DROP POLICY IF EXISTS frx_own_rows ON "{table}"',
            f'CREATE POLICY frx_own_rows ON "{table}" '
            f"USING (user_id = current_setting('{RLS_SETTING}', true)) "
            f"WITH CHECK (user_id = current_setting('{RLS_SETTING}', true))",
        ]
    return statements


# ---------------------------------------------------------------- storage limits at flush


def _megabytes(size):
    return f"{size / 1048576:.0f} MB"


@event.listens_for(Session, "before_flush")
def _storage_limits(session, _flush_context, _instances):
    """Hold a user's flush to the number of saves and the size of one save they may keep:
    413, like the picture quota, and nothing of the flush is written.

    Only sessions bound to a user with limits are checked (multi-user mode); local mode has
    none. A save counts while it holds a document with an archiveId (a deleted save keeps its
    row, emptied); a deleted save's name written again counts as a new one."""
    limits = session.info.get("frx_limits")
    if limits is None or (limits.saves is None and limits.save_bytes is None):
        return
    from fastapi import HTTPException
    from sqlalchemy import func, inspect, select

    from .save_schema import Archive, archive_storage_bytes

    added, written = 0, []
    for row in list(session.new) + list(session.dirty):
        if not isinstance(row, Archive) or row.deleted:
            continue
        if row in session.new:
            added += 1
        else:
            history = inspect(row).attrs.deleted.history
            if not getattr(row, "_value_written", False):
                continue
            if True in history.deleted:
                added += 1
        written.append(row)
    if limits.save_bytes is not None:
        for row in written:
            size = archive_storage_bytes(row)
            if size > limits.save_bytes:
                raise HTTPException(
                    413,
                    f"存档「{row.key}」有 {size / 1048576:.1f} MB，超过单个存档 "
                    f"{_megabytes(limits.save_bytes)} 的上限",
                )
    if limits.saves is not None and added:
        with session.no_autoflush:
            kept = session.scalar(
                select(func.count())
                .select_from(Archive)
                .where(
                    Archive.user_id == session.info["frx_user"],
                    Archive.deleted.is_(False),
                )
            )
        if kept + added > limits.saves:
            raise HTTPException(
                413, f"存档已有 {kept} 个，上限是 {limits.saves} 个，请先删除不用的存档"
            )
