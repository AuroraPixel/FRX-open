"""Explain where a save's storage quota is spent.

The 50 MB write limit counts the current state, every log's ordinary fields, and each
snapshot entity once by digest (``archive_storage_bytes``). When a long save reaches the
limit it is not obvious which of those grew; this tool prints the same total, split by
part, so a report can name the field instead of guessing (issue #36).

Nothing is written. Safe to run against a live database.

usage:
  uv run python -m frx.save_size                       # all saves
  uv run python -m frx.save_size --name 毛毛
  uv run python -m frx.save_size --archive-id 736f2055-...
  uv run python -m frx.save_size --url sqlite:////path/to/data.db
  uv run python -m frx.save_size --json
"""

import argparse
import json
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

# auth imports the users table that Archive's foreign key points at; importing it here
# registers every mapped table before a query configures the mappers (as frx.admin does).
from . import auth  # noqa: F401
from .domain import ROOT
from .save_schema import Archive, archive_storage_breakdown
from .storage import Store


def _human(size):
    return f"{size / 1048576:.2f} MiB"


def _rows(session, name, archive_id):
    query = select(Archive).where(Archive.deleted.is_(False))
    if name:
        query = query.where(Archive.name == name)
    if archive_id:
        query = query.where(Archive.archive_id == archive_id)
    return session.scalars(query.order_by(Archive.name, Archive.archive_id))


def report(session, name=None, archive_id=None):
    """Yield one breakdown dict per matching save, including per-snapshot-field detail."""
    for row in _rows(session, name, archive_id):
        detail = archive_storage_breakdown(row)
        by_field = {}
        for log in row.logs:
            for ref in log.snapshots:
                # A digest is counted once; keep the first field name that references it.
                by_field.setdefault(ref.field, {})[ref.snapshot_digest] = ref.size
        detail.update({
            "name": row.name,
            "archive_id": row.archive_id,
            "user_id": row.user_id,
            "version": row.version,
            "by_field": {field: sum(sizes.values()) for field, sizes in by_field.items()},
        })
        yield detail


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m frx.save_size", description=__doc__)
    parser.add_argument("--url", default=os.getenv("FRX_DATABASE_URL"),
                        help="数据库连接串；默认取 FRX_DATABASE_URL")
    parser.add_argument("--name", help="只看这个存档名")
    parser.add_argument("--archive-id", help="只看这个存档编号")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    url = args.url or f"sqlite:///{ROOT / '.frx' / 'frx.db'}"
    store = Store(url)
    try:
        with Session(store.engine) as session:
            rows = list(report(session, args.name, args.archive_id))
        if not rows:
            parser.error("没有匹配的存档")
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return
        for row in rows:
            print(f"存档 {row['name']} ({row['archive_id']}) v{row['version']}")
            print(f"  合计        {_human(row['total'])}")
            print(f"  当前状态    {_human(row['envelope'])}")
            print(f"  逐回合文本  {_human(row['logs'])}  ({row['log_count']} 回合)")
            print(f"  快照(去重)  {_human(row['snapshots'])}  "
                  f"({row['snapshot_count']} 个实体 / {row['snapshot_refs']} 次引用)")
            for field, size in sorted(row["by_field"].items(), key=lambda item: -item[1]):
                print(f"    - {field:<20} {_human(size)}")
    finally:
        store.engine.dispose()


if __name__ == "__main__":
    main()
