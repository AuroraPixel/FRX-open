import json
import subprocess
from pathlib import Path

from frx.life import new_life


def test_the_standing_gather_command_uses_one_day_and_accepts_explicit_days():
    root = Path(__file__).resolve().parents[1]
    archive = {
        "name": "松径",
        "data": {
            "archiveId": "gather-duration",
            "logs": [],
            "state": {
                "currentState": {
                    "0": {"B1": {"0": "B1", "1": "旅人", "2": "炼气三层", "26": "5"}},
                    "4": [{"id": "TIME_LOCATION_ROW", "0": "0001年 01月 05日 07:20/天南/越国（百莽山）"}],
                },
                "frxPlay": new_life("0001-01"),
            },
        },
    }

    def life(op, **args):
        payload = {"mode": "life", "op": op, "archive": archive, "seed": "gather", "args": args}
        output = subprocess.check_output(["node", "apps/engine/settle.cjs"], cwd=root,
                                         input=json.dumps(payload, ensure_ascii=False), text=True)
        return json.loads(output)

    [gather] = [verb for verb in life("view")["view"]["verbs"] if verb["kind"] == "gather"]
    assert not gather.get("off")
    assert gather["note"] == "耗时一日"
    bare = life("verb", kind="gather")
    explicit = life("verb", kind="gather", days=1)
    assert bare == explicit
    [receipt] = [receipt for receipt in bare["receipts"] if receipt["kind"] == "gather"]
    assert receipt["gather"]["days"] == 1
    assert receipt["gather"]["items"]
    assert life("preview", kind="gather", days=3)["preview"]["minutes"] == 3 * 24 * 60
    assert life("verb", kind="gather", days=11)["error"] == "refused"
