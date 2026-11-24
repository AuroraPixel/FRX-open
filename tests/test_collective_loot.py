"""Check actual bag gains for separately named pickups grouped in the next sentence."""

import asyncio
import json

import pytest
from frx.life import new_life
from frx.turn_runtime import settle_card

DROP = "那守卫遁走时，遗落下一枚沾泥的铜匣残角，以及半截带印的守关密简。"
PICKUP = "你抬手一引，两物轻巧落入掌中。"


def entry(item_id, name):
    return {"0": item_id, "1": name, "2": "重要物品", "3": "窄巷拾得", "4": "线索", "5": "1"}


def examine(story, names, held=(), receipts=()):
    state = {
        "0": {"B1": {"0": "B1", "1": "旅人", "2": "炼气一层", "26": "5"}},
        "1": {f"I{i}": entry(f"I{i}", name) for i, name in enumerate(held, 1)},
        "4": [{"id": "TIME_LOCATION_ROW", "0": "0001年 03月 04日 12:45/青野/鹭湾（窄巷）100,200"}],
    }
    archive = {"name": "拾取试验", "data": {"archiveId": "collective-loot-test", "logs": [],
              "state": {"currentState": state, "frxPlay": new_life("0001-03")}}}
    commands = "\n".join(f"set({json.dumps(entry(f'I{i}', name), ensure_ascii=False)})"
                         for i, name in enumerate(names, 90))
    result = asyncio.run(settle_card(archive, commands, "loot-test", reply=story,
                                     pilot={"receipts": list(receipts), "story": story}))
    assert not result["errors"]
    return result


def test_grouped_pickup_requires_each_new_item():
    result = examine(DROP + PICKUP, ["守关密简"], held=["铜匣残角"])
    [problem] = result["pilot"]["acquisitions"]
    assert "铜匣残角" in problem

    fixed = examine(DROP + PICKUP, ["守关密简", "铜匣残角"])
    assert not fixed["pilot"].get("acquisitions")
    assert {row["1"]: row["5"] for row in fixed["state"]["1"].values()} == {
        "守关密简": "1", "铜匣残角": "1",
    }


@pytest.mark.parametrize("story", [
    DROP + "你看着别人抬手一引，两物轻巧落入掌中。",
    DROP + "你没有伸手，两物掉回地上。",
    DROP + "你见那守卫说：『你抬手一引，两物轻巧落入掌中。』",
    DROP + "那人转身。" + PICKUP,
    DROP + PICKUP.replace("两物", "三物"),
    "守卫并未遗落下铜匣残角和守关密简。" + PICKUP,
])
def test_only_confirmed_pickups_require_a_gain(story):
    result = examine(story, [])
    assert not result["pilot"].get("acquisitions")
    assert not result["state"]["1"]


PURCHASE = {"kind": "act", "ok": True, "card": {"kind": "买卖", "title": "买下这枚刻纹铜构件"},
            "trade": {"direction": "buy", "price": 2}, "paid": [{"stat": "灵石", "before": 5, "after": 3}],
            "commands": 'add("B1",{"26":"3"})', "owns": {"currency": True}}
DELIVERY = "你走到摊前，付给小贩两块灵石，随手将那枚刻着水纹的刻纹铜构件摄入袖中。"


def test_an_unlisted_purchase_needs_a_new_item_when_the_player_received_it():
    result = examine(DELIVERY, [], held=["刻纹铜构件"], receipts=[PURCHASE])
    [problem] = result["pilot"]["acquisitions"]
    assert "刻纹铜构件" in problem

    result = examine(DELIVERY, ["刻纹铜构件"], receipts=[PURCHASE])
    assert not result["pilot"].get("acquisitions")
    assert result["state"]["0"]["B1"]["26"] == "3"


@pytest.mark.parametrize("story, trade", [
    ("你如数付了灵石，小贩却一把将那枚刻纹铜构件收入袖中。", PURCHASE["trade"]),
    ("你看着对方将那枚刻纹铜构件收入袖中。", PURCHASE["trade"]),
    ("你放下灵石，还没接过刻纹铜构件。", PURCHASE["trade"]),
    ("你问：『要我把刻纹铜构件收入袖中吗？』", PURCHASE["trade"]),
    (DELIVERY, {"direction": "buy", "price": 2, "fee": True}),
])
def test_unlisted_trade_only_checks_explicit_delivery_of_a_paid_purchase(story, trade):
    result = examine(story, [], receipts=[{**PURCHASE, "trade": trade}])
    assert not result["pilot"].get("acquisitions")
