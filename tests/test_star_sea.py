"""Exercise the original public demo's sea routes with synthetic saves."""

import copy
import json
import subprocess

from frx.domain import ROOT
from frx.life import new_life, regional_lore
from frx.save_schema import add_demo_coast

MAP = json.loads((ROOT / "content/map.json").read_text(encoding="utf-8"))
POINTS = {entry["name"]: entry for entry in MAP["points_of_interest"]}
EVENTS = json.loads((ROOT / "content/life/calendar.json").read_text(encoding="utf-8"))["fixed"]


def archive(place, rank="筑基后期", year=20, month=1, day=5):
    point = POINTS[place]
    when = f"{year:04d}年 {month:02d}月 {day:02d}日 07:20"
    where = f"{point['main_region']}/{point['sub_region']}（{place}）{point['x']},{point['y']}"
    player = {
        "0": "B1", "1": "行舟|男", "2": f"{rank}|散修", "4": "一切正常",
        "9": "年龄:32|寿元:300|灵根:真灵根 水, 火|修为进度:40%", "11": "{}", "26": "9000",
    }
    tables = {"0": {"B1": player}, "1": {}, "4": [{"id": "TIME_LOCATION_ROW", "0": f"{when}/{where}"}], "5": []}
    state = {"worldMap": copy.deepcopy(MAP), "currentState": tables, "frxPlay": new_life(f"{year:04d}-{month:02d}")}
    return {"name": "行舟", "data": {"archiveId": "test-sea", "state": state, "logs": []}}


def engine(value, **payload):
    result = subprocess.run(
        ["node", "apps/engine/settle.cjs"], cwd=ROOT,
        input=json.dumps({"archive": value, "seed": "demo-sea", **payload}), text=True,
        capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def test_an_old_demo_map_can_reach_the_original_sea_and_trigger_a_job():
    value = archive("回潮渡")
    state = value["data"]["state"]
    old_map = state["worldMap"]
    old_map["width"] = 430
    old_map["main_regions"] = [entry for entry in old_map["main_regions"] if entry["name"] == "潮岚道"]
    old_map["points_of_interest"] = [entry for entry in old_map["points_of_interest"] if entry["x"] < 320]
    prior = next(entry for entry in old_map["points_of_interest"] if entry["name"] == "回潮渡")
    prior["description"] = "旧档里的渡口描述"
    add_demo_coast(state)
    assert old_map["width"] == MAP["width"]
    assert prior["description"] == "旧档里的渡口描述"
    assert sum(entry["name"] == "回潮渡" for entry in old_map["points_of_interest"]) == 1
    view = engine(value, mode="life", op="view")["view"]
    assert any(hint.get("verb", {}).get("to") == "盐堤同盟总部" for hint in view["next"])

    value = archive("盐堤同盟总部")
    voyage = engine(value, mode="life", op="verb", args={"kind": "travel", "to": "橘舟屿"})
    receipt = next(receipt for receipt in voyage["receipts"] if receipt["kind"] == "travel")
    assert receipt["travel"]["arrived"]
    assert receipt["travel"]["teleport"]["stones"] == 3000
    outcome = engine(value, commands="", knowledge={}, story="", pilot={"receipts": voyage["receipts"], "story": ""})
    assert outcome["errors"] == []
    assert outcome["state"]["0"]["B1"]["26"] == "6000"
    assert outcome["frxPlay"]["starSea"]["visited"] == ["橘舟屿"]
    state = value["data"]["state"]
    state.update(currentState=outcome["state"], frxPlay=outcome["frxPlay"])
    view = engine(value, mode="life", op="view")["view"]
    assert any(hint.get("verb", {}).get("kind") == "job" and "护航" in hint["text"] for hint in view["next"])
    assert "落灯海" in regional_lore(value)


def test_public_sea_dungeons_open_on_the_calendar():
    for place in ("候潮石窟", "照海台"):
        event = next(event for event in EVENTS if event.get("place") == place)
        value = archive(place, "结丹初期", event["first"], event["month"], event["day"])
        realm = engine(value, mode="life", op="view")["view"]["place"]["realm"]
        assert realm["open"] and not realm.get("off")
        entered = engine(value, mode="life", op="realm", args={"action": "enter", "realm": event["id"]})
        assert entered["realm"]["exit"]


def test_original_demo_has_optional_people_and_quests_beyond_the_main_crossing():
    def notices(value):
        return engine(value, mode="life", op="notices")["notices"]["notices"]

    value = archive("竖灯城", "结丹初期")
    assert any(row["title"] == "听汐坊寻回药圃旧契" for row in notices(value))

    value = archive("桥尾寨", "结丹初期")
    assert all(row["kind"] != "试剑采药" for row in notices(value))
    play = value["data"]["state"]["frxPlay"]
    play["starSea"] = {"entered": "0019-01-01", "returned": "0019-12-20", "visited": ["荻风岭"]}
    play["realmsDone"] = {"xutian": "0019-07-01"}
    notice = next(row for row in notices(value) if row["kind"] == "试剑采药")
    assert notice["place"] == "荻风岭"
    assert "桥尾寨" in regional_lore(value, director=True)

    value = archive("荻风岭", "结丹初期")
    value["data"]["state"]["frxPlay"].update(play)
    view = engine(value, mode="life", op="view")["view"]
    assert any(hint["verb"].get("to") == "桥尾寨" for hint in view["next"] if hint.get("verb"))


def test_offshore_hunt_uses_the_local_high_tier_reward():
    result = subprocess.run(
        ["node", "-e", """
            const { roll } = require('./apps/engine/life/rewards.cjs');
            const loot = roll({}, '狩猎', { place: '白螺滩', tier: '四阶', danger: 60, seed: 'sea' });
            process.stdout.write(JSON.stringify(loot));
        """],
        cwd=ROOT, text=True, capture_output=True, check=True,
    )
    loot = json.loads(result.stdout)
    assert loot["place"] == "白螺滩" and loot["tier"] == "四阶"
    assert [item["name"] for item in loot["items"]] == ["海妖内丹"]
    assert 3 <= loot["items"][0]["count"] <= 4
