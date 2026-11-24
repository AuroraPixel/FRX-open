"""Alembic environment: the scripts run on the connection and transaction frx.migrate opens."""

from alembic import context
from frx.migrate import metadata

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("请用 python -m frx.migrate 执行迁移，它负责连接和事务")
context.configure(connection=connection, target_metadata=metadata(), transactional_ddl=True)
with context.begin_transaction():
    context.run_migrations()
