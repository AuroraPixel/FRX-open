"""A full save is coherent even while another window deletes it."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from frx import save_schema
from frx.auth import LOCAL_USER_ID
from frx.card_snapshots import pack_snapshot
from frx.card_store import CardStore
from frx.storage import Store


@pytest.fixture(params=["sqlite", "postgresql"])
def database(request, tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path / "data"))
    url = (request.getfixturevalue("pg_url") if request.param == "postgresql"
           else "sqlite:///" + str(tmp_path / "snapshot.db"))
    store = Store(url)
    store.initialize()
    yield store
    store.engine.dispose()


def save():
    state = {"currentState": {"0": {}}, "worldMap": {}, "frxPlay": {"version": 1}}
    snapshot = pack_snapshot({"state": state, "filler": "完整历史" * 4000})
    return {"name": "snapshot", "data": {
        "archiveId": str(uuid4()), "state": state,
        "logs": [{"id": "turn-1", "type": "ai", "content": "这一回合",
                  "frxStateSnapshot": snapshot}],
    }}


def test_full_read_and_delete_cannot_mix_versions(database, monkeypatch):
    records = CardStore(LOCAL_USER_ID, database.sessions)
    value = save()
    records.write("archives", value["name"], value, 0)
    reading, deleting, acquired, release = (threading.Event() for _ in range(4))
    local = threading.local()
    project = save_schema.archive_value
    write_lock = records.lock

    def paused_projection(row, lean=False):
        if getattr(local, "reading", False):
            reading.set()
            assert release.wait(5)
        return project(row, lean)

    def noted_lock(session):
        if getattr(local, "deleting", False):
            deleting.set()
        write_lock(session)
        if getattr(local, "deleting", False):
            acquired.set()

    monkeypatch.setattr(save_schema, "archive_value", paused_projection)
    monkeypatch.setattr(records, "lock", noted_lock)

    def read():
        local.reading = True
        return records.get("archives", value["name"])

    def delete():
        local.deleting = True
        return records.write("archives", value["name"], None, 1)

    with ThreadPoolExecutor(2) as pool:
        reader = pool.submit(read)
        assert reading.wait(5)
        writer = pool.submit(delete)
        try:
            assert deleting.wait(5)
            # SQLite can reserve a write while a reader is active, but cannot commit it;
            # PostgreSQL waits for the shared read barrier before acquiring the write lock.
            assert not writer.done()
        finally:
            release.set()
        loaded = reader.result(timeout=10)
        assert loaded["value"] == {"frxSchemaVersion": 1, **value}
        assert writer.result(timeout=10)["value"] is None
    assert records.get("archives", value["name"])["value"] is None


def test_materialize_refuses_missing_snapshot(database):
    records = CardStore(LOCAL_USER_ID, database.sessions)
    value = save()
    value["data"]["logs"][0]["frxStateSnapshot"] = {
        "codec": "frx-kept-v1", "sha256": "0" * 64, "bytes": 1,
    }
    with records.sessions() as session, pytest.raises(HTTPException) as caught:
        records.materialize(session, copy.deepcopy(value))
    assert caught.value.status_code == 422
    assert "快照缺失" in caught.value.detail


def test_compaction_at_quota_preserves_full_history(database, monkeypatch):
    import hashlib
    import json

    from frx.card_import import archive_of, document_of
    from frx.usage import Limits
    from sqlalchemy import func, select

    value = save()
    data = value["data"]
    # Stable map and character facts with one changing integer per turn. Their high-entropy
    # contents are individually compressible much less than they are across consecutive frames.
    facts = {str(i): {"text": hashlib.sha256(str(i).encode()).hexdigest()}
             for i in range(1800)}
    history = []
    previous = None
    for index in range(42):
        tables = {"0": facts, "4": [{"date": index}]}
        frame = pack_snapshot({"state": {"currentState": tables, "worldMap": facts}})
        log = {"id": f"turn-{index}", "type": "ai", "content": f"剧情 {index}",
               "stateSnapshot": json.dumps(tables), "frxStateSnapshot": frame}
        if previous is not None:
            log["frxBeforeSnapshot"] = previous
        history.append(log)
        previous = frame
    data["logs"] = history
    normal = CardStore(LOCAL_USER_ID, database.sessions)
    with monkeypatch.context() as patch:
        patch.setattr(
            save_schema.snapshot_storage, "stored_payload",
            lambda field, payload, raw: (payload, {}),
        )
        normal.write("archives", value["name"], value, 0)
    with normal.sessions() as session:
        row = normal.record(session, "archives", value["name"])
        before = save_schema.archive_storage_bytes(row)
    before_full = normal.get("archives", value["name"])["value"]

    limited = CardStore(LOCAL_USER_ID, database.sessions, limits=Limits(save_bytes=before // 2))
    next_value = limited.get("archives", value["name"], lean=True)["value"]
    next_value["data"]["logs"].append({"id": "new", "type": "ai", "content": "又一回"})
    result = limited.write("archives", value["name"], next_value, 1, lean=True)
    assert result["version"] == 2

    loaded = normal.get("archives", value["name"])["value"]
    assert loaded["data"]["logs"][:-1] == before_full["data"]["logs"]
    assert loaded["data"]["logs"][-1]["content"] == "又一回"
    assert archive_of(document_of(loaded))["data"]["logs"] == loaded["data"]["logs"]
    lean = normal.get("archives", value["name"], lean=True)["value"]
    with normal.sessions() as session:
        normal.materialize(session, lean)
        row = normal.record(session, "archives", value["name"])
        assert save_schema.archive_storage_bytes(row) < before // 2
        parts = session.scalar(select(func.count()).select_from(save_schema.LogSnapshotRef)
                               .where(save_schema.LogSnapshotRef.field.like("@part:%")))
        assert parts > 0
    assert lean == loaded

    # Deleting a copy must not collect any chunk the first archive still references.
    other = copy.deepcopy(loaded)
    other["name"] = "副本"
    other["data"]["archiveId"] = str(uuid4())
    normal.write("archives", other["name"], other, 0)
    normal.write("archives", other["name"], None, 1)
    assert normal.get("archives", value["name"])["value"] == loaded
