"""A settled crossing and its arrival commit together, even with a stale model time row."""

import asyncio
from types import SimpleNamespace

import pytest
from frx.life import new_life
from frx.life_turns import life_settler

START = "0001年 03月 04日 12:45/青野/鹭湾（旧城书斋）100,200"
AFTER_ACT = START.replace("12:45", "13:45")
ARRIVED = AFTER_ACT.replace("旧城书斋", "青野南岸")
STORY = "你顺着暗渠避开巡卫，终于潜回青野南岸水脉。"
COMMAND = 'add("TIME_LOCATION_ROW",{"0":"0001年 03月 04日 13:45/青野/鹭湾（玉山水闸）100,200"})'


def location_result(outcome="大成功", destination="青野南岸"):
    points = [
        {"name": "鹭湾", "main_region": "青野", "sub_region": "", "x": 100, "y": 200},
        {"name": "玉山", "main_region": "大泽", "sub_region": "", "x": 400, "y": 700},
        {"name": "旧城", "main_region": "远州", "sub_region": "", "x": 600, "y": 300},
    ]
    state = {
        "currentState": {
            "0": {"B1": {"0": "B1", "1": "旅人", "2": "炼气一层", "26": "5"}},
            "4": [{"id": "TIME_LOCATION_ROW", "0": START}],
        },
        "worldMap": {"points_of_interest": points},
        "frxPlay": new_life("0001-03"),
    }
    archive = {"name": "渡渠测试", "data": {
        "archiveId": "scene-arrival-test", "logs": [], "state": state,
    }}
    act = {"id": "R1", "kind": "act", "ok": True, "source": "engine",
           "card": {"title": f"避开山上的巡卫，暗渡回{destination}"},
           "check": {"kind": "潜行", "outcome": outcome, "roll": 10},
           "commands": f'add("TIME_LOCATION_ROW",{{"0":"{AFTER_ACT}"}})'}
    holder = SimpleNamespace(receipts=[act])
    _, settle = life_settler(archive, "arrival-test", {}, {"act": act}, holder)
    return holder, settle


def settle_story(settle, story, commands):
    raw = f"<content>{story}</content><upstore>{commands}</upstore>"
    return asyncio.run(settle(raw, story, commands))


@pytest.mark.parametrize("commands", [COMMAND, ""])
def test_arrival_uses_the_checked_action_and_keeps_its_time_once(commands):
    holder, settle = location_result()
    first = settle_story(settle, STORY, commands)
    retried = settle_story(settle, STORY, commands)
    assert first == retried
    assert not first["errors"] and not first["pilot"]["ownership"]
    assert first["state"]["4"][0]["0"] == ARRIVED
    assert [receipt["kind"] for receipt in holder.receipts] == ["act", "scene_arrival"]
    assert first["lifeBeforeReceipts"][0]["check"]["roll"] == 10
    assert len(first["lifeBeforeReceipts"]) == 1


@pytest.mark.parametrize(("outcome", "destination", "story"), [
    ("失败", "青野南岸", STORY),
    ("大成功", "青野南岸", "你还没能潜回青野南岸。"),
    ("大成功", "青野南岸", "你听见暗哨说：『他潜回青野南岸了。』"),
    ("大成功", "玉山", "你顺着暗渠抵达玉山。"),
])
def test_no_arrival_without_a_confirmed_local_success(outcome, destination, story):
    holder, settle = location_result(outcome, destination)
    result = settle_story(settle, story, "")
    assert result["state"]["4"][0]["0"] == AFTER_ACT
    assert [receipt["kind"] for receipt in holder.receipts] == ["act"]
