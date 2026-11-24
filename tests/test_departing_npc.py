import asyncio
import json

from frx.life import new_life
from frx.turn_runtime import settle_card


def test_departing_npc_keeps_the_relationship_settled_in_that_turn():
    healer = {"0": "C1", "1": "游医|男", "2": "炼气二层", "15": "0"}
    archive = {
        "name": "松径",
        "data": {
            "archiveId": "npc-departure",
            "logs": [],
            "state": {
                "worldBookEntries": [{"key": "C1", "title": "游医", "content": json.dumps(healer)}],
                "currentState": {
                    "0": {"B1": {"0": "B1", "1": "旅人", "2": "炼气三层", "26": "5"}, "C1": healer},
                    "4": [{"id": "TIME_LOCATION_ROW", "0": "0001年 01月 05日 07:20/天南/越国（百莽山）"}],
                },
                "frxPlay": new_life("0001-01"),
            },
        },
    }
    receipt = {
        "kind": "act", "ok": True, "commands": 'add("C1",{"15":"16"})',
        "owns": {"charStats": ["C1:好感"]},
    }
    story = "游医愿意记下这份恩情，告辞独自上山。"
    knowledge = {"knowledgeBaseEnabled": True, "attachBiographyToSnapshot": True}
    result = asyncio.run(settle_card(archive, 'de("C1")', "npc-departure", knowledge=knowledge,
                                     reply=story, pilot={"receipts": [receipt], "story": story}))

    assert not result["errors"] and not result["pilot"].get("ownership")
    assert "C1" not in result["state"]["0"]
    [biography] = result["biographySnapshot"]
    assert biography["key"] == "C1"
    assert json.loads(biography["content"])["15"] == "16"
