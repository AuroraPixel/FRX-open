"""Storage quota and inventory regressions for long cultivation-life saves."""

import hashlib
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from frx.auth import LOCAL_USER_ID, UserRecord
from frx.card_snapshots import pack_snapshot
from frx.card_store import CardStore
from frx.card_timeline import CardTimeline
from frx.storage import Store
from frx.usage import Limits
from test_reported_issues import archive, engine


def test_retrieval_cards_keep_the_item_through_pricing_engine_and_story():
    value = archive()
    st = value["data"]["state"]
    bag = st["currentState"]["1"]
    bag["I9"] = {"0": "I9", "1": "骨翼夜叉的双翼", "2": "材料", "3": "", "4": "风遁灵材", "5": "1"}
    st["frxPlay"]["scene"] = {"id": "S1", "title": "灵材易手", "beats": 1}
    titles = ("收回骨翼夜叉双翼抽身离开", "把骨翼夜叉的双翼收起", "从掌柜手中拿回夜叉双翼")
    result = engine(value, mode="life", op="cards", keep=True,
                    args={"cards": [{"kind": "用物", "title": title} for title in titles]})
    st.update(result["kept"])
    for card in result["cards"][:len(titles)]:
        assert not card["locked"]
        assert "收回骨翼夜叉的双翼" in card["sub"]
        assert card["cost"]["items"] == [
            {"id": "I9", "name": "骨翼夜叉的双翼", "count": 1, "consumed": False},
        ]

    historical = st["frxPlay"]["cards"][0]
    historical.pop("retrieved")
    historical["cost"]["items"][0]["consumed"] = True
    historical["sub"] = "用物 · 用掉骨翼夜叉的双翼"
    shown = engine(value, mode="life", op="view")["view"]["cards"][0]
    assert "收回骨翼夜叉的双翼" in shown["sub"]
    played = engine(value, mode="life", op="act", args={"index": 1}, keep=True)
    assert played["kept"]["currentState"]["1"]["I9"]["5"] == "1"
    assert not any(receipt["kind"] == "use_item" for receipt in played["receipts"])
    receipt = next(row for row in played["receipts"] if row["kind"] == "act")
    assert receipt["retrieved"]["id"] == "I9" and "I9" in receipt["owns"]["items"]

    calls = [
        {"id": "use", "name": "use_item", "arguments": json.dumps({"item_id": "I9"})},
        {"id": "sell", "name": "trade_item", "arguments": json.dumps(
            {"direction": "卖出", "item_name": "骨翼夜叉的双翼", "quantity": 1, "price": 100},
        )},
    ]
    tools = engine(value, mode="tools", calls=calls, receipts=played["receipts"])
    assert all(not row["receipt"]["ok"] and row["receipt"]["readOnly"] for row in tools["results"])

    ad_hoc = engine(value, mode="life", op="act", args={"card": {"title": "取回夜叉双翼"}},
                    keep=True)
    assert ad_hoc["card"]["retrieved"]["id"] == "I9"
    use = engine(value, mode="life", op="act", args={
        "card": {"kind": "用物", "title": "使用骨翼夜叉的双翼", "target": "I9"},
    }, keep=True)
    assert "I9" not in use["kept"]["currentState"]["1"]


@pytest.mark.parametrize("backend", ["sqlite", "postgresql"])
def test_save_limit_counts_a_shared_snapshot_once_and_keeps_restore_data(
    tmp_path, monkeypatch, request, backend,
):
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path / "data"))
    url = (request.getfixturevalue("pg_url") if backend == "postgresql"
           else f"sqlite:///{tmp_path}/capacity.db")
    store = Store(url)
    store.initialize()
    value = archive()
    name = value["name"]
    state = value["data"]["state"]
    previous = pack_snapshot({"state": state, "history": "龙" * 1900})
    latest = pack_snapshot({"state": state, "history": "虎" * 1900})
    value["data"]["logs"] = [
        {"id": "round-1", "type": "ai", "content": "上一回合。", "frxStateSnapshot": previous},
        {"id": "round-2", "type": "ai", "content": "本回合。",
         "frxBeforeSnapshot": previous, "frxStateSnapshot": latest},
    ]
    cutoff = 18_000
    assert len(json.dumps(value, ensure_ascii=False).encode()) > cutoff
    records = CardStore(LOCAL_USER_ID, store.sessions, limits=Limits(save_bytes=cutoff))
    saved = records.write("archives", name, value, 0, lean=True)
    updated = saved["value"]
    updated["data"]["state"]["currentState"]["0"]["B1"]["26"] = "7"
    updated["data"]["logs"].append({
        "id": "round-3", "type": "ai", "content": "又写入了一回合。", "frxBeforeSnapshot": latest,
    })
    written = records.write("archives", name, updated, saved["version"], lean=True)
    full = records.get("archives", name)["value"]
    assert full["data"]["state"]["currentState"]["0"]["B1"]["26"] == "7"
    assert [log["id"] for log in full["data"]["logs"]] == ["round-1", "round-2", "round-3"]
    assert full["data"]["logs"][1]["frxBeforeSnapshot"] == previous
    assert full["data"]["logs"][2]["frxBeforeSnapshot"] == latest

    unique = [hashlib.sha256(f"unique {index}".encode()).hexdigest() for index in range(1200)]
    updated["data"]["logs"][-1]["frxStateSnapshot"] = {"state": {"new": unique}}
    with pytest.raises(HTTPException) as err:
        records.write("archives", name, updated, written["version"], lean=True)
    assert err.value.status_code == 413
    assert records.get("archives", name)["version"] == written["version"]
    CardTimeline(records).restore_snapshot(name, written["version"], "round-2")
    restored = records.get("archives", name)["value"]["data"]
    assert restored["state"]["currentState"]["0"]["B1"]["26"] == "2"
    assert [log["id"] for log in restored["logs"]] == ["round-1", "round-2"]
    store.engine.dispose()


def test_storage_breakdown_matches_the_quota_and_splits_growth_sources(tmp_path):
    """The diagnostic must agree with the number the 413 guard uses (issue #36)."""
    from frx.save_schema import PART_FIELD, archive_storage_breakdown, archive_storage_bytes

    url = f"sqlite:///{tmp_path}/breakdown.db"
    store = Store(url)
    store.initialize()
    value = archive()
    state = value["data"]["state"]
    state["currentState"]["0"]["B1"]["26"] = "8"
    history = [{"text": hashlib.sha256(str(i).encode()).hexdigest()} for i in range(1200)]
    previous = pack_snapshot({"state": state, "history": history, "turn": 1})
    latest = pack_snapshot({"state": state, "history": history, "turn": 2})
    value["data"]["logs"] = [
        {"id": "round-1", "type": "ai", "content": "上一回合。", "frxStateSnapshot": previous},
        {"id": "round-2", "type": "ai", "content": "本回合。",
         "frxBeforeSnapshot": previous, "frxStateSnapshot": latest},
        {"id": "round-3", "type": "ai", "content": "又" * 4000, "frxBeforeSnapshot": latest},
    ]
    records = CardStore(LOCAL_USER_ID, store.sessions)
    records.write("archives", value["name"], value, 0, lean=True)
    with records.sessions() as session:
        row = records.record(session, "archives", value["name"], lean=True)
        detail = archive_storage_breakdown(row)
        assert detail["total"] == archive_storage_bytes(row)
        refs = [ref for log in row.logs for ref in log.snapshots]
        chunks = [ref for ref in refs if ref.field.startswith(PART_FIELD)]
        distinct_chunks = {ref.snapshot_digest: ref.size for ref in chunks}
        manifests = {ref.snapshot_digest: ref.size for ref in refs if ref not in chunks}
        assert 0 < len(distinct_chunks) < len(chunks)
        assert len(manifests) == 2
        assert detail["by_field"] == {
            "chunks": sum(distinct_chunks.values()), "shared": sum(manifests.values()),
        }
        assert detail["snapshot_ref_bytes"] == sum(
            len(ref.field) + len(ref.snapshot_digest) for ref in chunks
        )
        assert detail["snapshot_count"] == len(distinct_chunks) + len(manifests)
        assert detail["snapshot_refs"] == len(refs)
    assert detail["snapshots"] == sum(detail["by_field"].values())
    assert detail["total"] == sum(
        detail[key] for key in ("envelope", "logs", "snapshots", "snapshot_ref_bytes")
    )
    # The long round-3 body lands in logs, not snapshots, so the split names the growth source.
    assert detail["logs"] > detail["envelope"]
    store.engine.dispose()


def test_save_size_cli_reads_each_owner_through_postgres_rls(pg_server_role, monkeypatch, capsys):
    from frx.save_schema import Archive
    from frx.save_size import main
    from sqlalchemy import select, text

    store = Store(pg_server_role.server)
    store.initialize(pg_server_role.owner)
    other_id = str(uuid4())
    with store.sessions.begin() as session:
        session.add(UserRecord(id=other_id, username="other", username_key="other", role="player"))
    archive_ids = {}
    for owner in (LOCAL_USER_ID, other_id):
        value = archive()
        value["data"]["archiveId"] = archive_ids[owner] = str(uuid4())
        value["data"]["logs"] = []
        CardStore(owner, store.sessions).write("archives", value["name"], value, 0)
    with store.sessions() as session:
        assert session.scalar(text("SELECT row_security_active('archives')"))
        assert session.scalars(select(Archive.archive_id)).all() == []

    monkeypatch.setenv("FRX_DATABASE_URL", pg_server_role.server)
    monkeypatch.setenv("PGOPTIONS", "-c default_transaction_read_only=on")
    main(["--name", value["name"], "--json"])
    rows = json.loads(capsys.readouterr().out)
    assert {row["user_id"]: row["archive_id"] for row in rows} == archive_ids
    main(["--archive-id", archive_ids[other_id], "--json"])
    assert [row["user_id"] for row in json.loads(capsys.readouterr().out)] == [other_id]
    with pytest.raises(SystemExit) as error:
        main(["--archive-id", archive_ids[other_id], "--user-id", LOCAL_USER_ID])
    assert error.value.code == 2
    assert "没有匹配的存档" in capsys.readouterr().err
    store.engine.dispose()
