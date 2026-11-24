"""Tool-mode model admission for engine-settled turns (see docs/model-configuration.md).

Runs fixed samples against a model profile's model (the main model by default): streamed
tool calls, several calls in one round, valid arguments and a story that follows the tool
results. Writes <FRX_DATA_DIR>/tool-admission.json, keyed by model name; the server only
offers tool rounds to an admitted main model, and runs plot evolution itself only while the
evolution profile's model is admitted.

It is part of the server package so that it runs wherever the server does, the container
image included (which carries no tools/). Usage:

    python -m frx.tool_admission [--data-dir DIR] [--profile NAME]

in a container (docs/container-install.md), or from the source tree
`uv run --env-file .env python -m frx.tool_admission` (tools/tool_admission.py runs the same).
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from .card_profiles import PROFILES, CardProfiles
from .card_turns import PILOT_PRESET, TOOL_GUIDE, TOOL_SPECS
from .domain import ROOT
from .gateway import Gateway, ModelFailure, ModelSettings

BAG = "储物袋：I1 补气丸×2（服下后恢复10点法力）；I2 解毒丹×1（解除轻微中毒）。法力10/50，血量100/100，魅力3，物防2。"  # noqa: E501
NPC = "在场人物：C1 陈老汉，身上带着 I9 补气丸×1。"
SAMPLES = [
    {
        "name": "一轮内两次使用",
        "user": BAG + "\n玩家：我先服下一枚补气丸，再吃下解毒丹。",
        "tools": ["lookup_inventory", "use_item"],
        "choice": "required",
        "inventory": [
            {"id": "I1", "name": "补气丸", "type": "消耗品", "quantity": 2,
             "description": "", "effect": "服下后恢复10点法力"},
            {"id": "I2", "name": "解毒丹", "type": "消耗品", "quantity": 1,
             "description": "", "effect": "解除轻微中毒"},
        ],
        "expect": lambda calls: (
            [c["name"] for c in calls] == ["use_item", "use_item"]
            and {c["args"].get("item_id") for c in calls} == {"I1", "I2"}
            and all(c["args"].get("quantity") == 1 for c in calls)
        ),
    },
    {
        "name": "先接过再服用",
        "user": BAG + NPC + "\n玩家：陈老汉递给我一枚补气丸，我接过来当即服下。",
        "tools": ["lookup_inventory", "claim_item", "use_item"],
        "choice": "required",
        "expect": lambda calls: (
            calls and calls[0]["name"] == "claim_item" and calls[0]["args"].get("source_id") == "C1"
        ),
    },
    {
        "name": "同名道具先查询",
        "user": "储物袋：I1 补气丸×1（药铺所购）；I5 补气丸×1（师门所赠）。\n玩家：我服下补气丸。",
        "tools": ["lookup_inventory", "use_item"],
        "choice": "required",
        "expect": lambda calls: calls and calls[0]["name"] == "lookup_inventory",
    },
    {
        "name": "交涉检定",
        "user": NPC + "\n玩家：我向陈老汉求教他年轻时练过的剑诀。",
        "tools": ["resolve_check"],
        "choice": "auto",
        "expect": lambda calls: (
            calls
            and calls[0]["name"] == "resolve_check"
            and calls[0]["args"].get("kind") == "交涉"
            and calls[0]["args"].get("tier") in {"易", "中", "难", "极难"}
        ),
    },
    {
        "name": "受伤检定",
        "user": BAG + "\n玩家：我从三丈高的陡坡上直接跳下去。",
        "tools": ["resolve_check"],
        "choice": "auto",
        "expect": lambda calls: (
            calls and calls[0]["name"] == "resolve_check" and calls[0]["args"].get("kind") == "受伤"
        ),
    },
]


def schema_ok(call):
    spec = TOOL_SPECS.get(call["name"], {}).get("function", {}).get("parameters", {})
    args = call["args"]
    if not isinstance(args, dict):
        return False
    for key in spec.get("required", []):
        if key not in args:
            return False
    for key, rule in spec.get("properties", {}).items():
        if key not in args:
            continue
        value = args[key]
        if rule.get("type") == "integer" and not (
            isinstance(value, int) and value >= rule.get("minimum", value)
        ):
            return False
        if rule.get("type") == "string" and not isinstance(value, str):
            return False
        if "enum" in rule and value not in rule["enum"]:
            return False
    return True


async def stream_round(config, messages, tools, choice, **extra):
    started = time.monotonic()
    kwargs = {"tools": [TOOL_SPECS[t] for t in tools], "tool_choice": choice} if tools else {}
    kwargs.update(extra)
    response = await Gateway.complete(
        config,
        messages,
        stream=True,
        stream_options={"include_usage": True},
        max_tokens=6000,
        temperature=0.4,
        timeout=120,
        **kwargs,
    )
    text, slots = "", {}
    async for chunk in response:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text += delta.content or ""
        for call in getattr(delta, "tool_calls", None) or []:
            slot = slots.setdefault(call.index, {"id": None, "name": "", "arguments": ""})
            slot["id"] = call.id or slot["id"]
            if call.function and call.function.name:
                slot["name"] += call.function.name
            if call.function and call.function.arguments:
                slot["arguments"] += call.function.arguments
    calls = []
    for index in sorted(slots):
        slot = slots[index]
        try:
            args = json.loads(slot["arguments"] or "{}")
        except ValueError:
            args = None
        calls.append(
            {"id": slot["id"], "name": slot["name"], "args": args, "raw": slot["arguments"]}
        )
    return text, calls, round(time.monotonic() - started, 2)


async def follow_through(config):
    """After a tool result the model must write the story without calling tools."""
    messages = [
        {"role": "system", "content": PILOT_PRESET},
        {
            "role": "user",
            "content": BAG
            + "\n"
            + TOOL_GUIDE.format(names="use_item")
            + "\n玩家：我服下一枚补气丸。",
        },
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "use_item", "arguments": '{"item_id":"I1","quantity":1}'},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": json.dumps(
                {"ok": True, "结果": "使用「补气丸」×1：储物袋「补气丸」2→1；法力 10→20/50"},
                ensure_ascii=False,
            ),
        },
    ]
    text, calls, seconds = await stream_round(config, messages, [], None)
    ok = not calls and "<content>" in text and "补气丸" in text
    return {
        "name": "按工具结果写正文",
        "ok": ok,
        "seconds": seconds,
        "calls": [],
        "text": text[:160],
    }


async def run_sample(config, sample):
    """Allow one read-only inventory round, then require the original action contract.

    The game accepts inventory lookups before actions. The parallel-use sample still
    requires both uses in a single subsequent round; repeated lookups or partial uses fail.
    """
    messages = [
        {"role": "system", "content": PILOT_PRESET},
        {"role": "user", "content": sample["user"] + "\n"
         + TOOL_GUIDE.format(names="、".join(sample["tools"]))},
    ]
    text, calls, seconds = await stream_round(
        config, messages, sample["tools"], sample["choice"]
    )
    rounds = [{"seconds": seconds, "calls": [
        {"name": c["name"], "args": c["args"]} for c in calls]}]
    if (sample.get("inventory") and 1 <= len(calls) <= 2
            and all(c["name"] == "lookup_inventory" and schema_ok(c) and c.get("id")
                    for c in calls)
            and len({c["id"] for c in calls}) == len(calls)):
        messages.append({"role": "assistant", "content": text or None, "tool_calls": [
            {"id": c["id"], "type": "function", "function": {
                "name": c["name"], "arguments": json.dumps(c["args"], ensure_ascii=False)}}
            for c in calls
        ]})
        for call in calls:
            wanted = call["args"].get("name", "")
            items = [item for item in sample["inventory"] if wanted in item["name"]]
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": json.dumps({"kind": "lookup_inventory", "ok": True,
                                                    "readOnly": True, "items": items,
                                                    "commands": ""}, ensure_ascii=False)})
        text, calls, elapsed = await stream_round(
            config, messages, sample["tools"], sample["choice"]
        )
        seconds = round(seconds + elapsed, 2)
        rounds.append({"seconds": elapsed, "calls": [
            {"name": c["name"], "args": c["args"]} for c in calls]})
    ok = bool(calls) and all(schema_ok(c) for c in calls) and bool(sample["expect"](calls))
    return {"name": sample["name"], "ok": ok, "seconds": seconds,
            "calls": [{"name": c["name"], "args": c["args"]} for c in calls],
            "text": text[:120], "rounds": rounds}


async def admit(args):
    os.environ["FRX_DATA_DIR"] = args.data_dir
    settings = ModelSettings()
    config = CardProfiles(settings).load(args.profile)
    if not config.model:
        sys.exit(f"模型档案 {args.profile}（{PROFILES[args.profile]}）没有配置模型")
    results = []
    for sample in SAMPLES:
        try:
            results.append(await run_sample(config, sample))
        except ModelFailure as error:
            results.append({"name": sample["name"], "ok": False, "error": str(error)})
    try:
        results.append(await follow_through(config))
    except ModelFailure as error:
        results.append({"name": "按工具结果写正文", "ok": False, "error": str(error)})
    # Tool rounds can run with low reasoning effort when the gateway accepts it.
    low = {"name": "低推理强度的工具决策", "ok": False}
    try:
        messages = [
            {"role": "system", "content": PILOT_PRESET},
            {
                "role": "user",
                "content": SAMPLES[0]["user"] + "\n" + TOOL_GUIDE.format(names="use_item"),
            },
        ]
        _, calls, seconds = await stream_round(
            config, messages, ["use_item"], "required", reasoning_effort="low"
        )
        low.update(
            ok=bool(calls) and all(schema_ok(c) for c in calls),
            seconds=seconds,
            calls=[{"name": c["name"], "args": c["args"]} for c in calls],
        )
    except ModelFailure as error:
        low["error"] = str(error)
    passes = sum(r["ok"] for r in results)
    passed = passes == len(results) or (
        passes >= len(results) - 1 and results[0]["ok"] and results[-1]["ok"]
    )
    record = {
        "passed": passed,
        "passes": passes,
        "total": len(results),
        "lowEffort": low["ok"],
        "checkedAt": datetime.now(UTC).isoformat(),
        "profile": args.profile,
        "samples": [*results, low],
    }
    path = Path(args.data_dir) / "tool-admission.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    saved = json.loads(path.read_text()) if path.is_file() else {}
    saved.setdefault("models", {})[config.model] = record
    path.write_text(json.dumps(saved, ensure_ascii=False, indent=2))
    for r in results:
        print(
            ("通过" if r["ok"] else "未过"),
            r["name"],
            r.get("seconds"),
            json.dumps(r.get("calls"), ensure_ascii=False)[:160],
            r.get("error", ""),
        )
    verdict = "准入" if passed else "未准入"
    print(f"档案 {args.profile} 的模型 {config.model}：{passes}/{len(results)}，{verdict}")
    print(f"记录于 {path}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="工具准入：考一个模型档案的模型会不会用工具")
    parser.add_argument("--data-dir", default=os.getenv("FRX_DATA_DIR", str(ROOT / ".frx")),
                        help="数据目录，记录写进它的 tool-admission.json；默认取 FRX_DATA_DIR")
    parser.add_argument(
        "--profile",
        default="default",
        choices=sorted(set(PROFILES) - {"embedding"}),
        help="test this model profile's model, e.g. evolution (default: the main model)",
    )
    asyncio.run(admit(parser.parse_args(argv)))


if __name__ == "__main__":
    main()
