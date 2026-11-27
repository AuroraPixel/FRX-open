"""Explain where a save's storage quota is spent.

The report uses the write quota's accounting. Snapshot entities are counted once per save.
Chunks appear under ``chunks``, and snapshot entities referenced by multiple ordinary fields
appear under ``shared``. Chunk reference bytes are reported separately.
This command only reads the database.

usage:
  uv run python -m frx.save_size                       # all saves
  uv run python -m frx.save_size --name <存档名>
  uv run python -m frx.save_size --archive-id <存档编号> --user-id <用户编号>
  uv run python -m frx.save_size --url sqlite:////path/to/data.db
  uv run python -m frx.save_size --json
"""

import argparse
import json
import os

from sqlalchemy import select

from .auth import UserRecord
from .card_store import CardStore
from .save_schema import Archive, archive_storage_breakdown
from .storage import Store


def _human(size):
    return f"{size / 1048576:.2f} MiB"


def report(store, name=None, archive_id=None, user_id=None):
    """Read each owner's matching saves in their own row-level security transaction."""
    if user_id is None:
        # Account rows are visible to the server role so it can look up a user's ID.
        with store.sessions() as session:
            owners = session.scalars(select(UserRecord.id).order_by(UserRecord.id)).all()
    else:
        owners = [user_id]

    filters = [Archive.deleted.is_(False)]
    if name:
        filters.append(Archive.name == name)
    if archive_id:
        filters.append(Archive.archive_id == archive_id)
    for owner in owners:
        records = CardStore(owner, store.sessions)
        query = records.records_of("archives").where(*filters).order_by(
            Archive.name, Archive.archive_id,
        )
        with records.sessions() as session:
            records.read_lock(session)
            batch = [{
                "name": row.name, "archive_id": row.archive_id,
                "user_id": row.user_id, "version": row.version,
                **archive_storage_breakdown(row),
            } for row in session.scalars(query)]
        yield from batch


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m frx.save_size", description=__doc__)
    parser.add_argument("--url", default=os.getenv("FRX_DATABASE_URL"),
                        help="数据库连接串；默认取 FRX_DATABASE_URL")
    parser.add_argument("--name", help="只看这个存档名")
    parser.add_argument("--archive-id", help="只看这个存档编号")
    parser.add_argument("--user-id", help="只查这个用户的存档")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("请通过 --url 或 FRX_DATABASE_URL 指定数据库")
    store = Store(args.url)
    try:
        rows = list(report(store, args.name, args.archive_id, args.user_id))
        if not rows:
            parser.error("没有匹配的存档")
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return
        for row in rows:
            print(f"存档 {row['name']} ({row['archive_id']}) v{row['version']}")
            print(f"  合计        {_human(row['total'])}")
            print(f"  当前状态与元数据  {_human(row['envelope'])}")
            print(f"  日志字段          {_human(row['logs'])}  ({row['log_count']} 条)")
            print(f"  快照内容（去重）  {_human(row['snapshots'])}  "
                  f"({row['snapshot_count']} 个实体 / {row['snapshot_refs']} 次引用)")
            print(f"  分片引用          {_human(row['snapshot_ref_bytes'])}")
            for field, size in sorted(row["by_field"].items(), key=lambda item: -item[1]):
                field = {"chunks": "分片内容", "shared": "跨字段共享快照"}.get(field, field)
                print(f"    - {field:<20} {_human(size)}")
    finally:
        store.engine.dispose()


if __name__ == "__main__":
    main()
