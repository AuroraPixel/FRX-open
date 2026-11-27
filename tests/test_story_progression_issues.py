import copy

from test_reported_issues import archive, engine


def state_of(value):
    return value["data"]["state"]


def region(value, spot="试舟城"):
    state = state_of(value)
    state["worldMap"] = {"points_of_interest": [
        {"name": "试舟城", "x": 5, "y": 5, "main_region": "东陆", "sub_region": "青川",
         "description": "商贸繁盛的城镇，城内有坊市、丹房"},
    ]}
    state["currentState"]["4"][0]["0"] = f"0001年 01月 12日 07:20/东陆/青川（{spot}）5,5"
    return state


def test_chapter_funding_survives_payment_and_successful_investigation_is_proof():
    value = archive()
    state = state_of(value)
    state["currentState"]["0"]["B1"]["26"] = "1338"
    chapter = {"id": "c4", "title": "远渡", "conditions": [
        {"kind": "灵石", "value": "1000", "count": 1000},
        {"kind": "其他", "value": "打听明晰经阁古传送阵的开启枢纽与修补之法"},
    ]}
    plot = {"chapters": [chapter]}
    investigate = {"kind": "act", "ok": True, "check": {"kind": "探查", "outcome": "成功"},
                   "card": {"title": "在经阁查阅海防旧档，查明古传送阵的开启枢纽与修补之法"}}
    travel = {"kind": "travel", "ok": True, "commands": 'add("B1",{"26":"138"})',
              "owns": {"currency": True}}
    failed = {**investigate, "check": {"kind": "探查", "outcome": "失败"}}
    value_before = copy.deepcopy(value)
    not_yet = engine(value_before, chapterProgress=plot, pilot={"receipts": [failed]})
    value_before["data"]["state"]["frxPlay"] = not_yet["frxPlay"]
    marks = engine(value_before, mode="progress", plot=plot)["plot"]["chapters"][0]["conditions"]
    assert marks[1]["met"] is None
    result = engine(value, chapterProgress=plot, pilot={"receipts": [investigate, travel]})
    assert result["errors"] == []
    state.update(currentState=result["state"], frxPlay=result["frxPlay"])
    assert state["currentState"]["0"]["B1"]["26"] == "138"
    marks = engine(value, mode="progress", plot=plot)["plot"]["chapters"][0]["conditions"]
    assert [mark["met"] for mark in marks] == [True, True]
    assert "筹得灵石1338块" in marks[0]["detail"]
    later = {"chapters": [{**chapter, "id": "c5"}]}
    marks = engine(value, mode="progress", plot=later)["plot"]["chapters"][0]["conditions"]
    assert [mark["met"] for mark in marks] == [False, None]


def test_contract_registers_a_specific_home_and_entrance_leaves_currency_untouched():
    value = archive()
    state = region(value)
    bag = state["currentState"]["1"]
    bag["I9"] = {"0": "I9", "1": "清泉窟阵牌", "2": "重要物品",
                 "3": "试舟城管事立契所授", "4": "清泉窟护府大阵的禁制令牌，持此可出入洞府", "5": "1"}
    settled = engine(value, pilot={"receipts": []})
    assert settled["frxPlay"]["home"]["spot"] == "试舟城·清泉窟"
    state.update(currentState=settled["state"], frxPlay=settled["frxPlay"])
    shown = engine(value, mode="progress")["life"]["home"]
    assert shown["name"] == "清泉窟" and not shown["here"]
    for action, inside in (("enter", True), ("exit", False)):
        moved = engine(value, mode="life", op="verb", args={"kind": "home", "action": action}, keep=True)
        state.update(moved["kept"])
        assert engine(value, mode="progress")["life"]["home"]["here"] is inside
        assert state["currentState"]["0"]["B1"]["26"] == "2"
    released = engine(value, mode="life", op="verb", args={"kind": "home", "action": "leave"}, keep=True)
    state.update(released["kept"])
    assert "home" not in engine(value, mode="progress")["life"]


def test_story_recipe_scroll_lists_multiple_craftable_formulas_and_an_incomplete_plan():
    value = archive()
    value["data"]["archiveId"] = "f6f83a68-d2a7-4a13-ae74-db69d1d229fa"
    state = region(value, "试舟城·丹房")
    state["frxPlay"]["crafts"] = {"炼丹": {"done": 60}}
    bag = state["currentState"]["1"]
    bag.update({
        "I6": {"0": "I6", "1": "外海古丹方骨简", "2": "重要物品",
               "4": "载有融雷散与定煞海元丹的古方", "5": "1"},
        "I7": {"0": "I7", "1": "风雷翅器谱残卷", "2": "功法", "5": "1"},
        "I8": {"0": "I8", "1": "雷煞骨珠", "2": "材料", "5": "2"},
        "I9": {"0": "I9", "1": "冰魄草", "2": "材料", "5": "2"},
    })
    recipes = engine(value, mode="progress")["life"]["recipes"]
    assert [row["makes"] for row in recipes] == ["融雷散", "定煞海元丹", "风雷翅"]
    assert recipes[2]["note"]
    verb = {"kind": "craft", "recipe": recipes[0]["recipe"]}
    assert engine(value, mode="life", op="preview", args=verb)["preview"]["ok"]
    result = engine(value, mode="life", op="verb", args=verb, keep=True)
    made = result["kept"]["currentState"]["1"]
    assert (made["I6"]["5"], made["I8"]["5"], made["I9"]["5"]) == ("1", "1", "1")
    del bag["I6"]
    assert "手里没有" in engine(value, mode="life", op="preview", args=verb)["preview"]["reason"]


def test_completed_same_objective_satisfies_a_promise_even_when_creditor_is_away():
    value = archive()
    state = region(value)
    play = state["frxPlay"]
    goal = "搭救北礁被困的渔船"
    who = {"id": "C9", "name": "严泽"}
    promise = {"id": "Y1", "kind": "诺", "what": "答应严泽三日内前往" + goal,
               "who": who, "date": "0001-01-06", "due": "0001-01-09", "broken": "0001-01-10", "year": 1}
    grievance = {"id": "Y2", "kind": "怨", "from": "rule", "who": who, "date": "0001-01-10", "year": 1,
                 "what": "答应严泽的事过了期限没有办到：" + promise["what"]}
    play["karma"] = [promise, grievance]
    play["threadHistory"] = [{"id": "T1", "text": "赴" + goal, "status": "completed",
                              "date": "0001-01-08", "result": "渔船已经脱险"}]
    shown = engine(value, mode="progress")["life"]["karma"]
    assert [row["id"] for row in shown] == ["Y1"] and shown[0]["done"]
    result = engine(value, mode="life", op="verb", args={"kind": "wait", "days": 1}, keep=True)
    assert result["kept"]["frxPlay"]["karma"][0]["done"]["threadId"] == "T1"
    assert len(result["kept"]["frxPlay"]["karma"]) == 1
    play["threadHistory"][0]["date"] = "0001-01-10"
    shown = engine(value, mode="progress")["life"]["karma"]
    assert len(shown) == 2 and any(row.get("broken") for row in shown)


def test_golden_core_retreat_shows_the_faster_rate_and_fractional_carry():
    value = archive()
    state = region(value)
    player = state["currentState"]["0"]["B1"]
    player["2"] = "结丹初期|散修"
    player["9"] = "年龄:30|寿元:500|灵根:异灵根 水|修为进度:41%"
    preview = engine(value, mode="life", op="preview", args={"kind": "cultivate", "full": True})["preview"]
    assert preview["ok"]
    assert "每步12000日" in preview["formula"][0]["value"]
    assert any("零头也计入下次修炼" in line for line in preview["lines"])
