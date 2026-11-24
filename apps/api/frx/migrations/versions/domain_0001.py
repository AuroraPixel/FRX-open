"""Domain schema baseline. An empty database is required; legacy data is not imported."""

from alembic import op

revision = "domain_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    from frx.migrate import create_baseline

    create_baseline(op.get_bind())


def downgrade():
    raise RuntimeError("领域表没有旧结构降级路径，请另行使用旧版本及其数据库")
