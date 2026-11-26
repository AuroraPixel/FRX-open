"""Storage quota and inventory regressions for long cultivation-life saves."""

import json

import pytest
from fastapi import HTTPException
from frx.auth import LOCAL_USER_ID
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

    updated["data"]["logs"][-1]["frxStateSnapshot"] = {"state": {"new": "独" * 7000}}
    with pytest.raises(HTTPException) as err:
        records.write("archives", name, updated, written["version"], lean=True)
    assert err.value.status_code == 413
    assert records.get("archives", name)["version"] == written["version"]
    CardTimeline(records).restore_snapshot(name, written["version"], "round-2")
    restored = records.get("archives", name)["value"]["data"]
    assert restored["state"]["currentState"]["0"]["B1"]["26"] == "2"
    assert [log["id"] for log in restored["logs"]] == ["round-1", "round-2"]
    store.engine.dispose()
