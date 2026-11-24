import json
import subprocess
from pathlib import Path


def test_saved_skill_costs_use_explicit_amounts_or_the_shared_mana_rate():
    repo = Path(__file__).resolve().parents[1]
    script = """
const { skillCost } = require('./apps/engine/mechanics.cjs');
const stats = { 法力: { current: 30, max: 541 }, 血量: { current: 200, max: 570 } };
const costs = ['神识与法力', '少量灵力', '8点法力', '耗法力八', '最大法力的10%',
               '精血二滴，另需引子', '无', '不消耗法力', '符纸一张'];
process.stdout.write(JSON.stringify(costs.map(cost => skillCost({ 8: cost }, stats))));
"""
    raw = subprocess.check_output(["node", "-e", script], cwd=repo)
    rules = json.loads((repo / "content/combat.json").read_text())
    blood = (570 * rules["skills"]["bloodDropPercent"] * 2 + 99) // 100
    assert json.loads(raw) == [
        {"stat": "法力", "amount": 28},
        {"stat": "法力", "amount": 28},
        {"stat": "法力", "amount": 8},
        {"stat": "法力", "amount": 8},
        {"stat": "法力", "amount": 55},
        {"stat": "血量", "amount": blood},
        None,
        {"narrative": "不消耗法力"},
        {"narrative": "符纸一张"},
    ]
