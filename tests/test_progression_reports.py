"""Regression coverage for interrupted preparation, story casting, travel and resale."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from frx.auth import LOCAL_USER_ID
from frx.card_store import CardStore
from frx.life_turns import life_protocol, protected_action
from frx.main import create_app
from frx.storage import Store
from test_reported_issues import archive, engine


def state_of(value):
    return value["data"]["state"]


def mana(value, current):
    state_of(value)["currentState"]["0"]["B1"]["11"] = json.dumps(
        {"法力": {"current": current, "max": 100}, "血量": {"current": 30, "max": 30}},
        ensure_ascii=False,
    )


def test_spell_cards_distinguish_circulating_qi_from_a_named_skill_and_pay_mana():
    value = archive()
    state = state_of(value)
    state["currentState"]["0"]["B1"]["2"] = "结丹初期|散修"
    mana(value, 100)
    equipped = engine(value, mode="life", op="equip", args={"itemId": "I2"}, keep=True)
    state.update(equipped["kept"])
    offered = [
        {"kind": "施术", "title": "以凝霜真解温养阵脉", "target": "凝霜真解"},
        {"kind": "施术", "title": "封堵沙缝布设警禁", "target": "警禁"},
        {"kind": "施术", "title": "施展未学的敛息术", "target": "敛息术"},
        {"kind": "施术", "title": "催动法诀激发大挪移阵"},
    ]
    state["frxPlay"]["scene"] = {"id": "S1", "title": "古阵", "beats": 1}
    cards = engine(value, mode="life", op="cards", args={"cards": offered}, keep=True)
    assert [card["locked"] for card in cards["cards"][:4]] == [False, False, True, True]
    state.update(cards["kept"])
    settled = engine(value, mode="life", op="act", args={"index": 1}, keep=True)
    action = next(row for row in settled["receipts"] if row["kind"] == "act")
    assert action["check"]["kind"] == "施术"
    assert action["paid"][0]["after"] == 100 - cards["cards"][0]["cost"]["stats"][0]["amount"]
    assert not any(row["kind"] == "use_skill" for row in settled["receipts"])
    mana(value, 0)
    assert "法力不够" in engine(value, mode="life", op="act", args={"index": 1})["reason"]


def test_spell_cards_use_a_worn_methods_aspect_or_a_held_focus():
    value = archive()
    state = state_of(value)
    tables = state["currentState"]
    tables["0"]["B1"]["2"] = "结丹后期|散修"
    mana(value, 100)
    tables["1"].update({
        "I5": {"0": "I5", "1": "弱水真解", "2": "功法", "3": "三阶功法", "5": "1"},
        "I6": {"0": "I6", "1": "风灵残羽", "2": "材料", "5": "1"},
        "I7": {"0": "I7", "1": "覆地玄水残旗", "2": "阵旗", "5": "1"},
    })
    for item_id in ("I2", "I5"):
        state.update(engine(value, mode="life", op="equip", args={"itemId": item_id}, keep=True)["kept"])
    state["frxPlay"]["scene"] = {"id": "S1", "title": "试阵", "beats": 1}
    offers = [
        {"kind": "施术", "title": "借风暴停滞潜入风穴", "target": "风灵残羽"},
        {"kind": "施术", "title": "以弱水真意调和地火阵枢", "target": "弱水真意"},
        {"kind": "施术", "title": "以极阴冰煞封髓", "target": "极阴冰煞"},
        {"kind": "施术", "title": "布设覆地玄水隐匿法阵", "target": "覆地玄水隐匿法阵"},
        {"kind": "施术", "title": "施展敛息术", "target": "敛息术"},
    ]
    result = engine(value, mode="life", op="cards", args={"cards": offers[:4]}, keep=True)
    assert [card["locked"] for card in result["cards"][:4]] == [False] * 4, result["cards"]
    assert result["cards"][0]["cost"]["items"] == [
        {"id": "I6", "name": "风灵残羽", "count": 1, "consumed": False},
    ]
    state.update(result["kept"])
    used = engine(value, mode="life", op="act", args={"index": 1}, keep=True)
    assert used["kept"]["currentState"]["1"]["I6"]["5"] == "1"
    action = next(row for row in used["receipts"] if row["kind"] == "act")
    assert action["paid"][0]["after"] == 100 - result["cards"][0]["cost"]["stats"][0]["amount"]
    removed = state["currentState"]["1"].pop("I6")
    assert removed["5"] == "1"
    cards = engine(value, mode="life", op="cards", args={"cards": [offers[0], offers[-1]]})["cards"]
    assert all(card["locked"] for card in cards[:2])


def test_array_activation_does_not_reserve_a_turn_or_treat_a_formula_as_an_item(tmp_path, monkeypatch):
    monkeypatch.setenv("FRX_AUTH", "off")
    monkeypatch.setenv("FRX_DATA_DIR", str(tmp_path))
    store = Store(f"sqlite:///{tmp_path}/crossing.db")
    store.initialize()
    records = CardStore(LOCAL_USER_ID, store.sessions)
    value = archive()
    saved = records.write("archives", value["name"], value, 0)
    words = "催动法诀激发上古挪移大阵，以海图锁定星轨，远渡瀚海。"
    assert protected_action("请教阵师如何开启古传送阵") is None
    command = engine(value, mode="presettle", action={"text": words})
    assert not any(receipt["kind"] == "use_item" for receipt in command["receipts"])
    rid = str(uuid4())
    with TestClient(create_app(store=store), headers={"X-FRX-Client": "local"}) as client:
        response = client.post(f'/api/play/saves/{value["data"]["archiveId"]}/turns',
                               json={"input": words, "version": saved["version"], "requestId": rid})
        assert response.status_code == 422
        assert "远距传送由地图结算" in response.json()["error"]["message"]
    with records.sessions() as session:
        assert records.attempt(session, rid) is None
    assert records.get("archives", value["name"])["version"] == saved["version"]
    store.engine.dispose()


def test_foundation_is_estimated_for_the_next_gate_and_stronger_prose_is_rejected():
    value = archive()
    state = state_of(value)
    state["currentState"]["0"]["B1"]["2"] = "筑基后期|散修"
    state["frxPlay"].update(gates={"结丹": {"extra": 511}}, foundation={"筑基": "稳固"})
    sheet = engine(value, mode="life", op="gate")["gate"]
    polish = next(entry for entry in sheet["prepares"] if entry["key"] == "polish")
    assert polish["points"] == 0 and "累计打磨五百一十一日" in polish["text"]
    assert "再打磨五百六十九日得 1 分" in polish["text"]
    beat = {"gated": {"success": True, "foundation": "虚浮"}}
    template = "<content>{}</content><upstore></upstore>"
    assert life_protocol(template.format("结丹虽成，气机仍未沉凝稳固。"), beat, [], []) == []
    assert any("根基仍虚浮" in error for error in life_protocol(
        template.format("丹成了，原本虚浮的气机受真元反复冲刷，终于沉凝稳固。"), beat, [], [],
    ))


def test_rare_and_tiered_materials_have_consistent_shop_and_story_sale_prices():
    value = archive()
    state = state_of(value)
    state["worldMap"] = {"points_of_interest": [
        {"name": "明川京", "x": 5, "y": 5, "main_region": "南陆", "sub_region": "明川",
         "description": "商贸繁盛的都城"},
    ]}
    state["currentState"]["4"][0]["0"] += "/南陆/明川（明川京）5,5"
    bag = state["currentState"]["1"]
    for id, name, type_, use in (
        ("I10", "骨翼夜叉的双翼", "材料", "风遁灵材"),
        ("I11", "二阶引云晶石", "材料", "炼器辅料"),
        ("I12", "三阶阵图玉简", "材料", "传送阵证物"),
    ):
        bag[id] = {"0": id, "1": name, "2": type_, "3": use, "5": "1"}
    shop = engine(value, mode="life", op="shop")["shop"]
    prices = {row["id"]: row["price"] for row in shop["buys"]}
    assert prices["I10"] > 1000 and 0 < prices["I11"] < prices["I10"]
    assert "I12" not in prices
    quoted = engine(value, mode="life", op="cards", args={"cards": [
        {"kind": "买卖", "title": "将夜叉双翼售予掌柜"},
    ]})["cards"][0]
    assert not quoted["locked"] and quoted["trade"]["price"] == prices["I10"]
    sold = engine(value, mode="life", op="verb", args={"kind": "trade", "side": "sell", "id": "I10"},
                  keep=True)
    assert not sold.get("error"), sold
    tables = sold["kept"]["currentState"]
    assert "I10" not in tables["1"] and int(tables["0"]["B1"]["26"]) == 2 + prices["I10"]
