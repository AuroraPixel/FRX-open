"""Regression cases for misclassified manuals, free input and story trade cards."""

import json
import subprocess
from uuid import uuid4

from fastapi.testclient import TestClient
from frx.auth import LOCAL_USER_ID
from frx.card_store import CardStore
from frx.domain import ROOT
from frx.life import new_life
from frx.life_turns import priced_actions, protected_action
from frx.main import create_app
from frx.play_state import item_view
from frx.storage import Store


def archive():
    player = {
        "0": "B1", "1": "试舟|男", "2": "炼气十三层大圆满|散修", "4": "一切正常",
        "9": "年龄:30|寿元:100|灵根:真灵根 水|修为进度:100%", "11": "{}", "26": "2",
    }
    bag = {
        "I2": {"0": "I2", "1": "凝霜真解", "2": "重要物品",
               "3": "通明阁拓印所得", "4": "二阶极阴冰道功法，详载极阴凝煞与筑基归元之法", "5": "1"},
        "I3": {"0": "I3", "1": "凝霜真解残页", "2": "重要物品", "3": "拓印残页，是寻功法的线索", "4": "二阶极阴冰道功法", "5": "1"},
        "I4": {"0": "I4", "1": "冰魄玉髓", "2": "材料", "3": "炼制用的灵物", "4": "用于凝煞护脉", "5": "1"},
    }
    tables = {"0": {"B1": player}, "1": bag, "4": [{"id": "TIME_LOCATION_ROW", "0": "0001年 01月 05日 07:20"}]}
    return {"name": "试舟", "data": {"archiveId": str(uuid4()), "state": {
        "currentState": tables, "frxPlay": new_life(),
    }, "logs": []}}


def engine(value, **operation):
    result = subprocess.run(
        ["node", "apps/engine/settle.cjs"], cwd=ROOT, check=True,
        input=json.dumps({"archive": value, "seed": "reported-issues", **operation}),
        text=True, capture_output=True)
    return json.loads(result.stdout)


def test_granted_and_legacy_mislabelled_manuals_work_through_the_real_equip_and_gate():
    value = archive()
    bag = value["data"]["state"]["currentState"]["1"]
    assert item_view(bag["I2"]).type == "功法" and item_view(bag["I2"]).equippable
    assert item_view(bag["I3"]).type == "重要物品"
    granted = engine(value, commands='set({"0":"I88","1":"引潮真解","2":"重要物品","3":"二阶水道功法，通潮归元","5":"1"})',
                     story="你接下引潮真解。", pilot={"receipts": []})
    assert granted["errors"] == [] and granted["state"]["1"]["I88"]["2"] == "功法"
    equipped = engine(value, mode="life", op="equip", args={"itemId": "I2"}, keep=True)
    assert not equipped.get("error"), equipped
    value["data"]["state"].update(equipped["kept"])
    gate = engine(value, mode="life", op="gate")["gate"]
    cap = next(item for item in gate["requires"] if item["key"] == "cap")
    assert cap["met"], gate
    assert equipped["kept"]["currentState"]["1"]["I3"]["2"] == "重要物品"


def test_free_gate_and_method_changes_refuse_before_reserving_or_consuming(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_AUTH", "off")
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    store = Store(f"sqlite:///{tmp_path}/issue.db")
    store.initialize()
    records = CardStore(LOCAL_USER_ID, store.sessions)
    value = archive()
    before = records.write("archives", value["name"], value, 0)
    try:
        with TestClient(create_app(store=store), headers={"X-FRX-Client": "local"}) as client:
            endpoint = f'/api/play/saves/{value["data"]["archiveId"]}/turns'
            for words, panel in [
                ("在静室取冰魄玉髓炼化，凝就玄阴道基，冲击筑基", "冲关准备单"),
                ("改修《凝霜真解》为主修功法", "功法"),
            ]:
                rid = str(uuid4())
                response = client.post(endpoint, json={"version": before["version"], "input": words, "requestId": rid})
                assert response.status_code == 422, response.text
                assert panel in response.json()["error"]["message"]
                saved = records.get("archives", value["name"])
                assert saved["version"] == before["version"] and saved["value"] == before["value"]
                with store.sessions() as session:
                    assert records.attempt(session, rid) is None
    finally:
        store.engine.dispose()
    assert protected_action("询问长老如何冲击筑基") is None
    assert protected_action("装备《青锋剑》") is None
    assert protected_action("用旧阵器换取一部功法") is None


def test_narrative_only_material_has_no_consumption_receipt():
    result = engine(archive(), mode="presettle", action={"text": "服下冰魄玉髓", "items": []})
    [refused] = [row for row in result["receipts"] if row["kind"] == "use_item"]
    assert not refused["ok"] and not refused["commands"]
    assert "物品未消耗" in refused["reason"]


def test_buy_cards_price_explicit_fees_and_leave_barter_and_unknown_goods_unpriced():
    raw = """<content>守卫确认入城费只需两块灵石。集市只收旧阵器。</content>
<actions>
[买卖|交付入城费|守卫|||取得：入城]
[买卖|拿旧阵器换宝|旧阵器|||取得：换取宝物]
[买卖|买下手中黑布包||| |取得：取得布包]
</actions>"""
    waived, _ = priced_actions(raw.replace("入城费只需", "入城费不收"))
    assert "fee" not in waived[0]
    cards, fallback = priced_actions(raw)
    value = archive()
    result = engine(value, mode="life", op="cards", args={"cards": cards, "fallback": fallback}, keep=True)
    fee, barter, unknown = result["cards"][:3]
    assert fee["cost"]["stones"] == 2 and not fee["locked"]
    assert not barter["cost"]["stones"] and "以物易物" in barter["sub"]
    assert not unknown["cost"]["stones"] and "价格待议" in unknown["sub"]
    value["data"]["state"].update(result["kept"])
    paid = engine(value, mode="life", op="act", args={"index": 1}, keep=True)
    assert paid["kept"]["currentState"]["0"]["B1"]["26"] == "0"
    selected_barter = engine(value, mode="life", op="act", args={"index": 2}, keep=True)
    assert selected_barter["kept"]["currentState"]["0"]["B1"]["26"] == "2"
    assert selected_barter["kept"]["currentState"]["1"] == value["data"]["state"]["currentState"]["1"]


def test_old_trade_card_is_repriced_without_touching_the_saved_purse():
    value = archive()
    saved = value["data"]["state"]
    saved["frxPlay"].update(scene={"title": "入城", "beats": 1}, cards=[{
        "index": 1, "kind": "买卖", "title": "拿阵器换宝", "locked": True,
        "reason": "灵石不够：要 600 块，只有 2 块",
        "trade": {"direction": "buy", "item": None, "price": 600},
    }])
    [card] = engine(value, mode="life", op="view")["view"]["cards"]
    assert not card["locked"] and card["cost"]["stones"] == 0 and "以物易物" in card["sub"]


def test_abandoning_a_ready_reply_preserves_the_previous_commit(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_AUTH", "off")
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    store = Store(f"sqlite:///{tmp_path}/ready.db")
    store.initialize()
    records = CardStore(LOCAL_USER_ID, store.sessions)
    value = archive()
    earlier = {"id": "earlier", "type": "ai", "content": "此前已经过了一回。"}
    value["data"]["logs"] = [earlier, {"id": "just-sent", "type": "user", "content": "攻"}]
    saved = records.write("archives", value["name"], value, 0)
    rid = str(uuid4())
    records.begin_request(rid, value["name"], {"turn_action": {"text": "攻"}}, "synthetic")
    assert records.finish_request(rid, "<content>待提交战报</content>", "ready", {})
    try:
        with TestClient(create_app(store=store), headers={"X-FRX-Client": "local"}) as client:
            endpoint = f'/api/play/saves/{value["data"]["archiveId"]}'
            response = client.get(f"{endpoint}/turns/pending")
            assert response.json()["id"] == rid
            aborted = client.post(f"{endpoint}/undo", json={"version": saved["version"], "pendingTurnId": rid})
            assert aborted.status_code == 200, aborted.text
            assert records.request(rid)["status"] == "cancelled"
            current = records.get("archives", value["name"])["value"]["data"]
            assert current["state"] == saved["value"]["data"]["state"]
            assert [log["id"] for log in current["logs"]] == [earlier["id"]]
            assert client.get(f"{endpoint}/turns/pending").status_code == 204
    finally:
        store.engine.dispose()


def test_high_tier_manual_keeps_its_type_but_cannot_bypass_equipment_requirements():
    value = archive()
    saved = value["data"]["state"]
    commands = 'set({"0":"I91","1":"照雪秘录","2":"功法","3":"古修所遗","4":"三阶水道功法","5":"1"})'
    settled = engine(value, commands=commands, story="你接下照雪秘录。", pilot={"receipts": []})
    assert settled["errors"] == []
    saved["currentState"] = settled["state"]
    assert settled["state"]["1"]["I91"]["2"] == "功法"
    sheet = engine(value, mode="life", op="gate")["gate"]
    first = next(row for row in sheet["requires"] if row["key"] == "technique")
    assert not first["met"] and "凝霜真解" in first["text"]

    # An inaccessible manual remains visible in the bag, with the same reason the engine will use.
    del saved["currentState"]["1"]["I2"]
    pieces = engine(value, mode="life", op="view")["view"]["gear"]["pieces"]
    reason = pieces["I91"]["unusable"]
    assert "境界不足" in reason
    refused = engine(value, mode="life", op="equip", args={"itemId": "I91"}, keep=True)
    assert refused["reason"] == reason and "kept" not in refused
    plan = engine(value, mode="presettle", action={"text": "我装备《照雪秘录》", "items": []})
    assert not any(row["kind"] == "equip_item" and row["ok"] for row in plan.get("receipts", []))
    sheet = engine(value, mode="life", op="gate")["gate"]
    first = next(row for row in sheet["requires"] if row["key"] == "technique")
    assert not first["met"] and "照雪秘录" in first["text"] and "坊市" in first["text"]


def test_unknown_traded_and_quest_reward_manuals_are_classified_by_their_titles():
    value = archive()
    tables = value["data"]["state"]["currentState"]
    tables["6"] = {"T1": {"0": "T1", "1": "问学", "3": "引潮宝典 ×1", "5": "进行中（炼气）"}}
    calls = [
        {"id": "sale", "name": "trade_item",
         "arguments": json.dumps({"direction": "买入", "item_name": "空谷真解", "price": 1})},
        {"id": "quest", "name": "update_quest",
         "arguments": json.dumps({"quest_id": "T1", "status": "完成", "rewards": [{"name": "引潮宝典"}]})},
    ]
    results = engine(value, mode="tools", calls=calls, receipts=[])["results"]
    receipts = [row["receipt"] for row in results]
    assert all(row["ok"] for row in receipts), results
    settled = engine(value, commands="", story="", pilot={"receipts": receipts})
    new_items = {row["1"]: row["2"] for row in settled["state"]["1"].values()}
    assert new_items["空谷真解"] == new_items["引潮宝典"] == "功法"
