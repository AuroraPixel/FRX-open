"""Plot evolution run by the server in the background, and each save's own storyline.

After a turn commits the server may run the evolution model once (the "director"). It reads the
story since its last effective run, the state, the player's own instructions and its previous
result, and answers through one write_plan tool call: four items of guidance, foreshadowing
threads with stable ids, the storyline and whether the storyline's current chapter is done.

Every run is kept in data.frxDirector with the complete result after it. The effective run is the
last one whose source turn is still on the timeline, so undo, redo and snapshot restores move it
along by themselves. Nothing here touches currentState, which the page compares byte for byte at
turn start, and the background write does not raise the archive's version, so the page's next
save still matches. See docs/architecture.md (一回合怎么走, 回合之后).

A save in the cultivation life (life.life_of; docs/gameplay-plan.md item 17) runs differently,
and an old save never meets any of it:
- when: never by the count of turns. After the first scene that closes once a month has seen
  something (the engine marks frxPlay.directorDue in its month step), when the current chapter's
  engine conditions are all met, or when the player asks. A turn the engine settled alone (a
  verb) starts nothing.
- what: WRITE_PLAN_LIFE, WRITE_PLAN with clocks, dated events and pending events, under a preset
  that keeps the 不强制 rules as they are and adds two (clocks only from the player's own deeds
  and what the world is already doing; one hook at most once a season).
- the result: the three new kinds go through the engine's director op, which drops what breaks
  its rules (each drop logged and kept in the run), and the op's frxPlay is written into the
  save without raising its version, only while no turn of the save is under way and on the save
  as it is then (apply_life), with directorDue cleared.
- the turn prompt's block counts its rotation and its once-only rule by season, not by turns.
- an evolution model that has not passed tool admission runs nothing: the clocks and pending
  events come from the engine's own rules alone.
"""

import asyncio
import copy
import html
import json
import logging
import re
import time
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException

from . import card_turns
from .card_store import CardStore, state_digest
from .card_turns import TOOL_SPECS, live_memory, strip_cards, tool_capable, tool_message
from .domain import ROOT
from .gateway import Gateway, ModelFailure
from .life import life_of, regional_lore
from .life_memory import active_matters, life_evidence
from .storage import now
from .usage import scope as usage_scope

logger = logging.getLogger(__name__)

SETTINGS_KEY = "CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1"
DEFAULTS = {"enabled": True, "frequency": 5}
MAX_RUNS = 12
MAX_OPEN_THREADS = 10
MIN_PLOT_TURNS = 3
INJECTION_LIMIT = 1100
STORY_LIMIT = 6000
SUMMARY_LIMIT = 2000
STATE_LIMIT = 3000
MODEL_SECONDS = 120
RUN_SECONDS = 540
OPENING = "<h4>天道初启</h4>"
KINDS = ("境界", "持有", "到达", "日期", "倒下", "任务", "灵石", "其他")
GUIDANCE = (
    ("main_line", "明线"),
    ("hidden_line", "暗线"),
    ("incident", "突发事件"),
    ("characters", "登场人物"),
)
# The guidance item a turn's prompt names for the story to carry, by turns since the run.
FOCUS = ("明线", "登场人物", "突发事件", "暗线")
REASONS = {
    "frequency": "按触发频率",
    "chapter": "个人主线当前一章由引擎判断的条件已全部达成",
    "manual": "玩家要求立即推演",
    "month": "月结里出了事，之后的头一场戏收场",
    "evidence": "已有已结算的线头结果，请逐项核验这一章",
}
# The cultivation life: a season is three months of the game's calendar.
SEASON_MONTHS = 3
# How long the result of a life run waits for a turn under way to end before it is given up.
LIFE_HOLD_SECONDS = 300
LIFE_HOLD_POLL = 0.5
# How many times in a row the save may move under a life run's result before it is given up.
LIFE_MOVES = 5
# The time a life run keeps, of its own RUN_SECONDS, to record itself after its wait.
LIFE_SPARE_SECONDS = 15


def _realms():
    try:
        realms = json.loads((ROOT / "content/combat.json").read_text())["realms"]
        return tuple(realms["order"]) + tuple(realms.get("aliases") or {})
    except (OSError, ValueError, KeyError, TypeError):
        return ("凡人", "炼气", "筑基", "结丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫")


REALMS = _realms()

DIRECTOR_PRESET = """你是《云汀修行录》文字RPG的幕后推演者。叙事模型写每一回合的正文；你在回合之间整理局势，为接下来几个回合写出剧情指导、伏笔和个人主线，供叙事模型参考。结果只能通过调用write_plan提交，不要输出别的内容。

【事实】一切以【当前状态】和已经发生的剧情为准，不得矛盾：
- 已倒下、身亡或已被了结的人物不能再回来；离场的人物可以合理地回归。
- 主角没有的东西（道具、功法、灵石、身份、人脉）不能当作已有；主角需要的东西只能写成可以争取的机会。
- 时间、地点和境界要合乎眼下的处境，不写主角去不了的地方、接触不到的层级。

【玩家的指示】有内容时必须遵守，它优先于你自己的构想。

【不强制】主线和指导只以机会和事件的形式出现在主角周围，比如有人找上门、路上撞见、消息传来。玩家不接，世界照常运转并产生后果，比如机会被别人拿走。不替玩家做决定，不把玩家带到某处，不写玩家的行动和心理。玩家没有回应时，同一个钩子五个回合内最多提一次。
- 指导和主线里不写「主角必须」「务必」「只能」，写成「可以」「若……则……」这样的机会和后果。
- 不为了让玩家接主线而制造期限、诅咒、毒誓、追杀、胁迫或抓捕；剧情里已有的威胁照常发展，但不要加码去逼玩家就范。
- 玩家拒绝或连续几个回合不理当前一章的目标时，让这个机会被别人拿走、过期或淡去，不再在指导里推它，并按玩家正在做的事改写当前一章（见【个人主线】的rewrite_current），主线跟着玩家走。

【指导】明线：当前事件的直接后果。暗线：幕后的人物、势力或潜在危机。突发事件：接下来几个回合可能发生的一件意外。登场人物：建议引入或回归的人物及其来意。四项各不超过200字，具体到人、事、地，能直接写进正文。突发事件和登场人物写成主角无论接下来去哪里都可能遇上的事（会找上门、追上来或传来消息），不要只在某个地点等着主角。

【伏笔】接着上一份推演写。有未回收的伏笔时，指导里至少推进其中一条，并在那一项里写出它的编号（如F2）。已经在正文里兑现、或已不可能发生的伏笔，把编号写进resolved。new_threads最多3条，每条不超过80字，写尚未揭开的悬念，不带编号，不要与已有的伏笔重复。

【个人主线】只在【本次任务】要求时写plot：
- title不超过20字；truth是幕后真相，不超过200字，必须用到出身、先天气运、世界因子中的至少两样；hook是给玩家看的引子，不超过100字，不泄露真相。
- 章节循序渐进，第一章贴合主角眼下的处境和境界。每章title不超过20字，不带「第几章」字样；goal不超过80字，写清要做成什么。
- 每章1到4个完成条件，至少一个由引擎判断。种类与value的写法：境界（境界名，如炼气一层、筑基初期）；持有（具体的物品名，如筑基丹、听弦剑诀；也可以只写类别：功法、丹药、法宝、武器、护甲、材料，表示有任意一件；不要写「一阶灵丹」这类含糊的叫法；count写数量）；到达（地名）；日期（游戏日期，如0001年03月01日）；倒下（人物名）；任务（任务标题）；灵石（数量）；其他（一句话，只用于引擎判断不了的事，如查明真相）。
- 已完成的章不能改。玩家明显绕开当前一章、走上了别的路时，把plot.rewrite_current设为true，chapters的第一项就是改写后的当前一章（贴合玩家正在做的事），其后是之后的章节；否则不要设它。

【章节判断】主线进行中时，判断当前一章的「其他」类条件是否已经在正文里达成，填写chapter_done并附一句理由。由引擎判断的条件以引擎为准：引擎显示没有全部达成时，这一章不能完成。"""  # noqa: E501

NON_FORCING = (
    "主线只以机会和事件的形式出现（有人找上门、路上撞见、消息传来）；"
    "玩家不接，世界照常运转并产生后果；不替玩家做决定，不把玩家带到某处，"
    "不为逼玩家接主线制造期限、诅咒或胁迫；玩家没有回应时，五个回合内最多提一次。"
)

_CONDITION = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "value": {
            "type": "string",
            "description": "境界名、物品名、地名、游戏日期、人物名、任务标题、灵石数量，"
            "或「其他」的一句话",
        },
        "count": {"type": "integer", "minimum": 1, "description": "持有的数量，可空"},
    },
    "required": ["kind", "value"],
}
_CHAPTER = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "不超过20字"},
        "goal": {"type": "string", "description": "不超过80字"},
        "conditions": {"type": "array", "items": _CONDITION},
    },
    "required": ["title", "goal", "conditions"],
}
_GUIDANCE = {
    "type": "object",
    "description": "剧情指导，四项各不超过200字",
    "properties": {
        "main_line": {"type": "string", "description": "明线：当前事件的直接后果"},
        "hidden_line": {"type": "string", "description": "暗线：幕后的人物、势力或潜在危机"},
        "incident": {"type": "string", "description": "突发事件：接下来可能发生的一件意外"},
        "characters": {"type": "string", "description": "登场人物：建议引入或回归的人物"},
    },
    "required": [key for key, _ in GUIDANCE],
}
WRITE_PLAN = {
    "type": "function",
    "function": {
        "name": "write_plan",
        "description": "提交本次推演的结果：剧情指导、伏笔的增减、个人主线，"
        "以及当前一章是否完成。",
        "parameters": {
            "type": "object",
            "properties": {
                "guidance": _GUIDANCE,
                "new_threads": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "新埋下的伏笔，最多3条，每条不超过80字；没有就给空列表",
                },
                "resolved": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "本次回收的伏笔编号，如F2；没有就给空列表",
                },
                "plot": {
                    "type": "object",
                    "description": "个人主线，只在【本次任务】要求时填写",
                    "properties": {
                        "title": {"type": "string", "description": "标题，不超过20字"},
                        "truth": {"type": "string", "description": "幕后真相，不超过200字"},
                        "hook": {"type": "string", "description": "给玩家看的引子，不超过100字"},
                        "chapters": {"type": "array", "items": _CHAPTER},
                        "rewrite_current": {
                            "type": "boolean",
                            "description": "玩家明显绕开当前一章时为true："
                            "chapters第一项改写当前一章",
                        },
                    },
                },
                "chapter_done": {
                    "type": "object",
                    "description": "当前一章是否完成；没有进行中的主线时填否",
                    "properties": {
                        "done": {"type": "boolean"},
                        "why": {"type": "string", "description": "一句理由"},
                    },
                    "required": ["done", "why"],
                },
            },
            "required": ["guidance", "new_threads", "resolved", "chapter_done"],
        },
    },
}


# ------------------------------------------------------------------ the cultivation life's plan

CLOCK_RULES = json.loads((ROOT / "content/life/clocks.json").read_text(encoding="utf-8"))
PENDING_RULES = json.loads((ROOT / "content/life/pending.json").read_text(encoding="utf-8"))


def _named(vocabulary):
    """A vocabulary of the rule data as the prompt names it: key（名字）、…"""
    return "、".join(
        f"{key}（{entry['name'] if isinstance(entry, dict) else entry}）"
        for key, entry in vocabulary.items()
        if key != "notes"
    )


# What a rule's `needs` (content/life/clocks.json) is, as the prompt asks for it.
_NEEDS = {"days": "日数", "item": "物品名", "stones": "灵石数", "person": "人物的编号或名字",
          "task": "差事的编号或标题"}


def _needs_text():
    """Which field each rule of the clocks' vocabulary needs, from the data: 每过若干日、离开范围
    满若干日要写days（日数）；…"""
    found = {}
    for side in ("rises", "falls"):
        for entry in CLOCK_RULES[side].values():
            if isinstance(entry, dict):
                for need in entry.get("needs") or []:
                    found.setdefault(need, []).append(entry["name"])
    return "；".join(
        f"{'、'.join(names)}要写{need}（{_NEEDS.get(need, need)}）" for need, names in found.items()
    )


def _rule_schema(vocabulary, falls):
    properties = {
        "kind": {"type": "string", "enum": [key for key in vocabulary if key != "notes"]},
        "steps": {"type": "integer", "minimum": 1, "description": "一次进退几格，缺省一格"},
        "days": {"type": "integer", "minimum": 1, "maximum": 360, "description": "日数"},
        "item": {"type": "string", "description": "物品名"},
        "stones": {"type": "integer", "minimum": 1, "description": "灵石数"},
        "person": {"type": "string", "description": "人物编号或名字"},
        "task": {"type": "string", "description": "任务编号或标题"},
    }
    if falls:
        properties["clear"] = {"type": "boolean", "description": "一下清空"}
    return {"type": "object", "properties": properties, "required": ["kind"]}


_CLOCK = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "钟的名字，不超过12字"},
        "scope": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": list(CLOCK_RULES["scopes"])},
                "value": {
                    "type": "string",
                    "description": "地图地点或地域的名字；只冲着主角时留空",
                },
            },
            "required": ["kind"],
        },
        "size": {"type": "integer", "enum": list(CLOCK_RULES["sizes"])},
        "value": {"type": "integer", "minimum": 0, "description": "起于几格"},
        "rises": {"type": "array", "items": _rule_schema(CLOCK_RULES["rises"], False)},
        "falls": {"type": "array", "items": _rule_schema(CLOCK_RULES["falls"], True)},
        "full": {"type": "string", "description": "满了发生什么，不超过60字"},
    },
    "required": ["name", "scope", "size", "rises", "falls", "full"],
}
_DATED = {
    "type": "object",
    "properties": {
        "date": {"type": "string", "description": "游戏日期，写成0001-03-15，不早于今天"},
        "title": {"type": "string", "description": "名字，不超过20字"},
        "place": {"type": "string", "description": "地点，可空"},
        "note": {"type": "string", "description": "一句说明，可空"},
    },
    "required": ["date", "title"],
}
_HOOK = {
    "type": "object",
    "properties": {
        "trigger": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": list(PENDING_RULES["triggers"])},
                "value": {"type": "string", "description": "日期、地点、境界、钟或人物"},
            },
            "required": ["kind", "value"],
        },
        "seed": {"type": "string", "description": "一句种子，不超过120字"},
        "expires": {"type": "string", "description": "过期的日子，写成0001-03-15，可空"},
    },
    "required": ["trigger", "seed"],
}
LIFE_KEYS = ("clocks", "dated", "pending")
# A lead (疑点, plan item 26): a thread as the player may read it, and where to look.
_LEAD = {
    "type": "object",
    "properties": {
        "thread": {"type": "string",
                   "description": "伏笔的编号，如F3；本次新埋的按new_threads的顺序写新1、新2"},
        "line": {"type": "string",
                 "description": "给玩家看的一句话，不超过40字：只写玩家已经察觉的蹊跷，不说出真相"},
        "where": {"type": "string",
                  "description": "去哪查，写成问谁或去哪（如问老六、去镜洲），不超过20字"},
    },
    "required": ["thread", "line", "where"],
}


def _life_plan():
    plan = copy.deepcopy(WRITE_PLAN)
    plan["function"]["description"] += (
        "修仙人生的存档另交新起的压力钟、带日期的事、待发生的事和疑点。")
    parameters = plan["function"]["parameters"]
    parameters["properties"].update(
        clocks={"type": "array", "items": _CLOCK, "description": "新起的压力钟；没有就给空列表"},
        dated={"type": "array", "items": _DATED, "description": "带日期的事；没有就给空列表"},
        pending={"type": "array", "items": _HOOK, "description": "待发生的事；没有就给空列表"},
        leads={"type": "array", "items": _LEAD,
               "description": "疑点：每条未回收的伏笔一句给玩家看的话和去哪查；没有就给空列表"},
        chapter_evidence={
            "type": "array",
            "description": "本章的「其他」条件已完成的线头凭据。只引用本次任务列出的编号和结果原句",
            "items": {
                "type": "object",
                "properties": {
                    "condition": {"type": "integer", "minimum": 1, "maximum": 4},
                    "thread": {"type": "string", "description": "已结算的线头编号，如T18"},
                    "quote": {"type": "string", "description": "已结算线头结果的原句"},
                },
                "required": ["condition", "thread", "quote"],
            },
        },
    )
    parameters["required"] = [*parameters["required"], *LIFE_KEYS, "leads"]
    return plan


# WRITE_PLAN with the three kinds a save in the cultivation life adds; WRITE_PLAN stays as it is.
WRITE_PLAN_LIFE = _life_plan()

# 不强制 as it is, two rules added to it, and what the three new kinds are.
_LAST_RULE = "（见【个人主线】的rewrite_current），主线跟着玩家走。"
LIFE_RULES = (
    "\n- 这个存档玩的是修仙人生：同一个钩子，一季（游戏里的三个月）之内最多提一次。"
    "\n- 压力钟只写两样：玩家自己惹出来的后果，和世界本来就在发生的事。"
)
LIFE_SECTION = (
    "【钟、日历与待发生的事】修仙人生里，日子由玩家的指令一天天过，事情找上门时才演成一场戏。"
    "write_plan另有三样，没有就给空列表，引擎核对之后才收下，不合规矩的丢掉：\n"
    f"- clocks：新起的压力钟。一口钟是一件正在逼近的事，几格满了就发生。写名字（不超过12字）、"
    f"范围（{_named(CLOCK_RULES['scopes'])}；地点或地域写名字，只冲着主角的不写）、几格"
    f"（{'、'.join(str(size) for size in CLOCK_RULES['sizes'])}之一）、起于几格、怎么涨、怎么消、"
    f"满了发生什么（不超过60字）。涨法只从这几种里选：{_named(CLOCK_RULES['rises'])}；"
    f"消法只从这几种里选：{_named(CLOCK_RULES['falls'])}。{_needs_text()}，少了就整口钟不收。"
    f"同时最多{CLOCK_RULES['limit']}口钟，"
    "已有的钟不要再起。\n"
    "- dated：带日期的事，写日期（游戏日期，写成0001-03-15，不早于今天）、名字（不超过20字）、"
    "地点和一句说明。\n"
    f"- pending：待发生的事，由头只认{_named(PENDING_RULES['triggers'])}，值分别写日期"
    "（0001-03-15）、地图地点、境界、钟的编号或名字、人物的编号或名字（只写一样）；种子写一句，不超过120字；"
    f"可写过期的日子（0001-03-15）。同时最多挂{PENDING_RULES['limit']}件，已经挂着的不要重复。\n"
    "- leads：疑点。每条伏笔（已有的写编号，本次新埋的按顺序写新1、新2）写一句给玩家看的话"
    "（不超过40字，只写玩家已经察觉的蹊跷，不许说出真相）和去哪查（问谁或去哪，如问老六、去镜洲，"
    "不超过20字）。"
    "主角在戏里查实了一条，引擎记下；一章的疑点都查实了，引擎排一场揭晓的戏。\n"
    "【个人主线】修仙人生里，每一章的终点对着一道关（筑基、结丹、元婴……）或一桩大事（开院会、"
    "沉钟泽的试炼、魔道入侵这样的世界大事）：goal写明是哪一关或哪一桩，完成条件里至少一条对着它"
    "（那个境界，或那桩大事的日期、地点）。主角的功法到不了下一个境界时（没写上限的功法只到它那一阶"
    "的境界：一阶炼气、二阶筑基……），这一章先给一条寻到够得着的功法的路（宗门藏经阁、秘境、拍卖、"
    "前辈所赠）。\n"
    "【因果】【心结】是主角闯出来的恩、怨、债、诺和亏心事，拿它们写戏：恩可以有人来报，怨可以有人"
    "来寻仇，债主会上门，诺的期限会到。"
)


def _life_preset():
    if _LAST_RULE not in DIRECTOR_PRESET:
        raise RuntimeError("DIRECTOR_PRESET's 不强制 changed: place the life's rules again")
    return DIRECTOR_PRESET.replace(_LAST_RULE, _LAST_RULE + LIFE_RULES, 1) + "\n\n" + LIFE_SECTION


DIRECTOR_PRESET_LIFE = _life_preset()

# The turn prompt's 不强制 for a save in the cultivation life: its once-only rule by the season.
NON_FORCING_LIFE = NON_FORCING.replace("五个回合内最多提一次", "一季之内最多提一次")


class DirectorError(Exception):
    """A run that cannot finish; the message is shown to the player in the settings."""


class DirectorSkipped(DirectorError):
    """A run not made: the player's usage is at its limit, or the evolution model of a save in
    the cultivation life has not passed tool admission. Recorded as skipped, with why."""


# ------------------------------------------------------------------ stored data


def blank():
    return {"version": 1, "runs": [], "plotDisabled": False, "lastAttempt": None}


def director_of(data):
    """A normalized copy of data.frxDirector."""
    stored = (data or {}).get("frxDirector")
    result = blank()
    if isinstance(stored, dict):
        runs = stored.get("runs")
        if isinstance(runs, list):
            result["runs"] = [run for run in runs if isinstance(run, dict)]
        result["plotDisabled"] = bool(stored.get("plotDisabled"))
        attempt = stored.get("lastAttempt")
        result["lastAttempt"] = attempt if isinstance(attempt, dict) else None
    return copy.deepcopy(result)


def _logs(data):
    return [log for log in (data or {}).get("logs") or [] if isinstance(log, dict)]


def is_turn(log):
    """A committed AI turn: not the opening, a ghost, a summary or a turn waiting to settle."""
    return (
        isinstance(log, dict)
        and log.get("type") == "ai"
        and not log.get("isGhost")
        and not log.get("isDeepSummary")
        and not log.get("isUndoSnapshot")
        and not log.get("frxPending")
        and OPENING not in str(log.get("content") or "")
    )


def timeline_ids(data):
    """Log ids on the current timeline, including the ones a deep summary compressed."""
    ids = set()
    for log in _logs(data):
        ids.add(log.get("id"))
        if log.get("isUndoSnapshot"):
            for item in log.get("snapshotOfLogs") or []:
                if isinstance(item, dict):
                    ids.add(item.get("id"))
    ids.discard(None)
    return ids


def _summarizable(logs):
    flags = ("isDeepSummary", "isSnapshot", "isUndoSnapshot", "isGhost")
    kept = [
        log
        for log in logs
        if not any(log.get(flag) for flag in flags)
        and OPENING not in str(log.get("content") or "")
    ]
    return sorted(kept, key=lambda log: str(log.get("timestamp") or ""))


def _merged(snapshot, summary, before):
    ids = snapshot.get("mergedLogIds")
    if isinstance(ids, list):
        by_id = {log.get("id"): log for log in before}
        return [by_id[i] for i in ids if i in by_id]
    span = summary.get("mergedRange") or {}
    start, end = span.get("start"), span.get("end")
    if isinstance(start, int) and isinstance(end, int) and start > 0:
        return _summarizable(before)[start - 1 : end]
    return []


def expanded_logs(data):
    """The timeline with a deep summary replaced by the turns it compressed, while its undo
    snapshot is still there, so that compressing old turns does not change the turn count."""
    logs = _logs(data)
    result = list(logs)
    present = {log.get("id") for log in logs}
    for snapshot in logs:
        if not snapshot.get("isUndoSnapshot"):
            continue
        before = [log for log in snapshot.get("snapshotOfLogs") or [] if isinstance(log, dict)]
        before_ids = {log.get("id") for log in before}
        summary_id = snapshot.get("summaryLogId")

        def matches(log, snapshot=snapshot, summary_id=summary_id, before_ids=before_ids):
            if not log.get("isDeepSummary"):
                return False
            if summary_id:
                return log.get("id") == summary_id
            if log.get("undoSnapshotId"):
                return log["undoSnapshotId"] == snapshot.get("id")
            return log.get("id") not in before_ids

        found = [log for log in result if matches(log)]
        if len(found) != 1:
            continue
        merged = [
            log for log in _merged(snapshot, found[0], before) if log.get("id") not in present
        ]
        if merged:
            index = next(i for i, log in enumerate(result) if log is found[0])
            result[index : index + 1] = merged
    return [log for log in result if not log.get("isUndoSnapshot")]


def turn_positions(logs):
    """Each log id's committed-turn count up to and including it, and the total."""
    count, positions = 0, {}
    for log in logs:
        if is_turn(log):
            count += 1
        if log.get("id") is not None:
            positions[log["id"]] = count
    return positions, count


def _effective_index(runs, ids):
    for index in range(len(runs) - 1, -1, -1):
        if runs[index].get("logId") in ids:
            return index
    return None


def effective_run(data):
    """The last run whose source turn is still on the current timeline."""
    runs = director_of(data)["runs"]
    index = _effective_index(runs, timeline_ids(data))
    return runs[index] if index is not None else None


def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def turns_since(data, run, logs=None):
    """Committed turns on this timeline after the run's source turn (all of them without one)."""
    positions, total = turn_positions(expanded_logs(data) if logs is None else logs)
    if run is None:
        return total
    start = positions.get(run.get("logId"))
    if start is None:
        start = _int(run.get("turn"))
    return max(0, total - start)


def current_index(plot):
    if not isinstance(plot, dict) or plot.get("status") == "已完结":
        return None
    chapters = plot.get("chapters") or []
    for index, chapter in enumerate(chapters):
        if chapter.get("status") == "进行中":
            return index
    for index, chapter in enumerate(chapters):
        if chapter.get("status") != "已完成":
            return index
    return None


def plot_payload(plot):
    """The storyline as the engine reads it (presettle and progress): no truth, no hook."""
    keys = ("id", "title", "goal", "status", "conditions")
    return {
        "id": plot.get("id"),
        "chapters": [
            {key: copy.deepcopy(chapter.get(key)) for key in keys}
            for chapter in plot.get("chapters") or []
            if isinstance(chapter, dict)
        ],
    }


def active_plot(data):
    """The effective run's storyline, unless the player switched it off for this save."""
    director = director_of(data)
    if director["plotDisabled"]:
        return None
    index = _effective_index(director["runs"], timeline_ids(data))
    plot = director["runs"][index].get("plot") if index is not None else None
    return plot if isinstance(plot, dict) and plot.get("chapters") else None


def presettle_plot(data):
    plot = active_plot(data)
    return plot_payload(plot) if plot else None


def public_plot(plot):
    if not isinstance(plot, dict):
        return None
    return {key: copy.deepcopy(value) for key, value in plot.items() if key != "truth"}


def director_settings(config, owned):
    """Whether plot evolution runs and how often.

    A saved choice (plotEvolutionChosen) stands as stored. Without one, the server's defaults
    apply while it owns plot evolution and the page's old defaults (off) apply otherwise. Older
    saved values without the mark are not a choice: the old default was off.
    """
    config = config if isinstance(config, dict) else {}
    frequency = _int(config.get("plotEvolutionFrequency"), DEFAULTS["frequency"])
    frequency = min(max(frequency, 1), 1000)
    enabled = bool(config.get("plotEvolutionEnabled"))
    if config.get("plotEvolutionChosen"):
        return {"enabled": enabled, "frequency": frequency, "chosen": True}
    if owned:
        return {**DEFAULTS, "chosen": False}
    return {"enabled": enabled, "frequency": frequency, "chosen": False}


def update_director(records, name, archive_id, change):
    """Apply change(data, director) to the stored frxDirector without raising the version.

    The server keeps its own frxDirector whenever the page saves, so a background write here is
    never lost and never makes the page's next save fail a version check.
    Returns change's result, or None when the save is gone or was replaced.
    """
    with records.sessions.begin() as session:
        records.lock(session)
        row = records.record(session, "archives", name, lock=True)
        value = row.value if row else None
        if not isinstance(value, dict) or not isinstance(value.get("data"), dict):
            return None
        if value["data"].get("archiveId") != archive_id:
            return None
        director = director_of(value["data"])
        outcome = change(value["data"], director)
        row.value = {**value, "data": {**value["data"], "frxDirector": director}}
        return outcome


# ------------------------------------------------------------------ engine marks


def chapter_marks(source, chapter):
    """The engine's per-condition marks for one chapter, in the chapter's own order."""
    if isinstance(source, list):
        return source
    if not isinstance(source, dict):
        return None
    for item in source.get("chapters") or []:
        if isinstance(item, dict) and item.get("id") == chapter.get("id"):
            marks = item.get("conditions")
            return marks if isinstance(marks, list) else None
    if isinstance(source.get("conditions"), list):
        return source["conditions"]
    return None


def _mark(marks, index, condition):
    if not marks or index >= len(marks) or not isinstance(marks[index], dict):
        return None
    mark = marks[index]
    return mark if mark.get("kind") in (None, condition.get("kind")) else None


def all_met(chapter, marks):
    """Every engine-judged condition of the chapter is met, by the engine's own marks."""
    conditions = [c for c in (chapter or {}).get("conditions") or [] if isinstance(c, dict)]
    checkable = [i for i, c in enumerate(conditions)
                 if c.get("kind") != "其他" or c.get("evidence")]
    if not checkable or marks is None:
        return False
    return all((_mark(marks, i, conditions[i]) or {}).get("met") is True for i in checkable)


def completed_story_facts(value):
    """Recent, completed matters with verified result text, on this save's current timeline."""
    history = (life_of(value) or {}).get("threadHistory") or []
    return {item["id"]: item["result"] for item in history[-24:] if isinstance(item, dict)
            and re.fullmatch(r"T\d+", str(item.get("id") or ""))
            and item.get("status") == "completed"
            and isinstance(item.get("result"), str) and item["result"].strip()}


def story_review(plot, facts):
    index = current_index(plot)
    if index is None or not facts:
        return None
    chapter = plot["chapters"][index]
    conditions = [c for c in chapter.get("conditions") or [] if c.get("kind") == "其他"]
    if not any(not c.get("evidence") for c in conditions):
        return None
    return state_digest({
        "chapter": chapter.get("id"),
        "conditions": [c["value"] for c in conditions],
        "facts": facts,
    })


def story_review_text(chapter, facts):
    lines = [f"{n}. {c['value']}" for n, c in enumerate(chapter.get("conditions") or [], 1)
             if c.get("kind") == "其他" and not c.get("evidence")]
    if not lines or not facts:
        return ""
    return ("逐项核验本章的剧情条件。只在结果明确证明目标已完成时填写 chapter_evidence，"
            "condition 用下列序号，thread 用 T 编号，quote 照抄结果中证明完成的原句。"
            "境界等数值条件照常判断。\n" + "\n".join(lines)
            + "\n已结算线头结果：\n"
            + "\n".join(f"{key}：{result}" for key, result in facts.items()))


def attach_evidence(chapter, claims, facts, marks):
    """Bind individually verified facts. Return marks for new bindings in this same run."""
    conditions = chapter.get("conditions") or []
    checked = list(marks) if isinstance(marks, list) else None
    for claim in claims[:4]:
        if not isinstance(claim, dict):
            continue
        n, thread = claim.get("condition"), claim.get("thread")
        quote = _text(claim.get("quote"))
        if (type(n) is not int or not 1 <= n <= len(conditions)
                or not isinstance(thread, str) or not 4 <= len(quote) <= 80
                or quote not in facts.get(thread, "")):
            continue
        condition = conditions[n - 1]
        if condition.get("kind") != "其他" or condition.get("evidence"):
            continue
        condition["evidence"] = {"threadId": thread, "quote": quote}
        if checked is not None and n <= len(checked):
            checked[n - 1] = {"kind": "其他", "met": True}
    return checked


def _thread_number(key):
    digits = re.sub(r"\D", "", str(key))
    return int(digits) if digits else 0


def uncited_threads(plan, open_ids):
    """The guidance carries no thread that was open before this run, while some are still open
    after it (a run that closes them all has nothing left to carry)."""
    remaining = set(open_ids) - set(plan.get("resolved") or [])
    if not remaining:
        return []
    text = " ".join(str(value) for value in (plan.get("guidance") or {}).values())
    cited = {"F" + number for number in re.findall(r"[FＦ]\s*(\d+)", text)}
    if cited & set(open_ids):
        return []
    listed = "、".join(sorted(remaining, key=_thread_number))
    return [
        "指导没有推进任何一条未回收的伏笔：在某一项指导里推进其中一条，并写出它的编号"
        f"（未回收：{listed}；本次新埋的伏笔不算）"
    ]


async def fresh_chapter_errors(value, prep, plan, progress, turn):
    """A chapter written in this run must not be done the moment it is written: its engine
    conditions already met would pay its reward for nothing (a rewrite that repeats the chapter
    it has just finished, say). Returns the problems for the repair round."""
    if not plan.get("plot"):
        return []
    _, plot, _, _ = settle_plan(prep, plan, progress.get("plot"), turn)
    if not plot:
        return []
    earlier = (prep.plot or {}).get("chapters") or []
    def goals(chapter):
        return [{key: value for key, value in condition.items() if key != "evidence"}
                for condition in chapter.get("conditions") or []]

    before = {c.get("id"): goals(c) for c in earlier if isinstance(c, dict)}
    fresh = [
        c
        for c in plot.get("chapters") or []
        if c.get("status") != "已完成"
        and (c.get("id") not in before or before[c.get("id")] != goals(c))
    ]
    if not fresh:
        return []
    marks = (await engine_progress(value, plot_payload(plot))).get("plot")
    numbers = {c.get("id"): n for n, c in enumerate(plot.get("chapters") or [], 1)}
    return [
        f"第{numbers[c['id']]}章「{c.get('title')}」由引擎判断的条件现在就已全部达成，"
        "要改成玩家接下来才能做到的事，不要重复已完成的章节"
        for c in fresh if all_met(c, chapter_marks(marks, c))
    ]


async def engine_progress(archive_value, plot=None):
    """The engine's progress mode: cultivation status and the storyline's condition marks."""
    payload = {"mode": "progress", "archive": archive_value}
    if plot:
        payload["plot"] = plot_payload(plot)
    try:
        result = await card_turns.run_engine(payload)
    except Exception as error:  # the progress view and the director work without it
        logger.warning("director_progress_failed error=%s", type(error).__name__)
        return {}
    return result if isinstance(result, dict) and not result.get("errors") else {}


# ------------------------------------------------------------------ prompt text


def _cut(text, limit):
    text = str(text if text is not None else "").strip()
    return text if len(text) <= limit else text[: max(limit - 1, 0)] + "…"


def _clip(text, limit):
    """Shorten at a sentence end when one is near enough, otherwise with an ellipsis."""
    text = str(text if text is not None else "").strip()
    if len(text) <= limit:
        return text
    if limit < 2:
        return ""
    head = text[: limit - 1]
    stop = max(head.rfind(mark) for mark in "。！？；")
    return head[: stop + 1] if stop >= limit // 2 else head + "…"


def clean_text(text):
    text = strip_cards(str(text or ""))
    text = re.sub(r"<li[^>]*>", "\n- ", text, flags=re.I)
    text = re.sub(r"<(?:br|/p|/li|/div|/h\d|/summary|/details)\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\s*\n\s*", "\n", text).strip()


def condition_text(condition):
    kind, value = condition.get("kind"), _cut(condition.get("value"), 60)
    count = _int(condition.get("count"), 1)
    return {
        "境界": f"境界达到{value}",
        "持有": f"持有{value}" + (f"×{count}" if count > 1 else ""),
        "到达": f"到达{value}",
        "日期": f"时间不早于{value}",
        "倒下": f"{value}倒下",
        "任务": f"完成任务「{value}」",
        "灵石": f"灵石不少于{value}",
    }.get(kind, value)


def _mark_text(mark, condition, judge):
    if condition.get("kind") == "其他" and (mark is None or mark.get("met") is not True):
        return f"（{judge}）"
    if mark is None or mark.get("met") not in (True, False):
        return ""
    return "（已达成）" if mark["met"] else "（未达成）"


def conditions_text(chapter, marks=None, judge="由剧情判断"):
    conditions = [c for c in chapter.get("conditions") or [] if isinstance(c, dict)]
    return "；".join(
        condition_text(c) + _mark_text(_mark(marks, i, c), c, judge)
        for i, c in enumerate(conditions)
    )


def _fill(items, budget):
    """Shorten texts so that together they fit the budget, shortest first (water filling)."""
    limits, left = {}, max(budget, 0)
    order = sorted(range(len(items)), key=lambda i: len(items[i]))
    for position, index in enumerate(order):
        limits[index] = min(len(items[index]), left // (len(items) - position))
        left -= limits[index]
    return [_clip(items[i], limits[i]) for i in range(len(items))]


def _months(text):
    """Months from 0001年 01月 to a game time written as the time row writes it, or None."""
    found = re.search(r"(\d+)\s*年\s*(\d+)\s*月", str(text or ""))
    return (int(found[1]) - 1) * 12 + int(found[2]) - 1 if found else None


def seasons_since(data, run):
    """Whole seasons of the game's calendar since the run (its gameTime): a life save's count."""
    then, today = _months((run or {}).get("gameTime")), _months(game_time(data))
    return 0 if then is None or today is None else max(0, today - then) // SEASON_MONTHS


def director_block(data, marks_source=None):
    """【主线】, 【剧情指导】 and 【未回收的伏笔】 for the turn prompt, at most 1100 characters.
    A save in the cultivation life counts its once-only rule and its rotation by season."""
    life = life_of({"data": data}) is not None
    director = director_of(data)
    index = _effective_index(director["runs"], timeline_ids(data))
    if index is None:
        return ""
    run = director["runs"][index]
    main = ""
    plot = run.get("plot")
    position = None if director["plotDisabled"] else current_index(plot)
    if position is not None:
        chapter = plot["chapters"][position]
        marks = chapter_marks(marks_source, chapter) if marks_source is not None else None
        head = (
            f"【主线】《{_cut(plot.get('title'), 20)}》第{position + 1}章"
            f"「{_cut(chapter.get('title'), 20)}」：{_cut(chapter.get('goal'), 80)}\n"
            f"完成条件：{_cut(conditions_text(chapter, marks), 140)}\n"
            "幕后真相（不要直接告诉玩家）："
        )
        rules = "\n" + (NON_FORCING_LIFE if life else NON_FORCING)
        room = max(360 - len(head) - len(rules), 40)
        main = head + _clip(plot.get("truth"), room) + rules
        if life and position + 1 < len(plot["chapters"]):
            later = plot["chapters"][position + 1]
            main += ("\n后续一章的可能方向（幕后草案，玩家尚未作此决定）："
                     + _cut(later.get("goal") or later.get("title"), 60))

    threads = ""
    for thread in run.get("threads") or []:
        if not isinstance(thread, dict):
            continue
        item = f"{thread.get('id')} {_cut(thread.get('text'), 60)}"
        candidate = (threads + "；" if threads else "【未回收的伏笔】") + item
        if len(candidate) > 160:
            break
        threads = candidate
    guidance = run.get("guidance") or {}
    labels = [label for _, label in GUIDANCE if str(guidance.get(label) or "").strip()]
    texts = [str(guidance[label]).strip() for label in labels]
    # One item per turn is named for the story to carry, in rotation, so that every item gets a
    # turn of its own before the next run; it is shown whole and the others share what is left.
    # In the cultivation life an item holds for a season of the game's calendar.
    shift = (seasons_since(data, run) if life else turns_since(data, run)) % len(FOCUS)
    focus = next((label for label in FOCUS[shift:] + FOCUS[:shift] if label in labels), None)
    note = (
        f"本回合正文顺带落实「{focus}」这一项：不与玩家的行动冲突时照写；冲突时改成在玩家所在之处"
        "发生（找上门、追上来或消息传来），不替玩家改变行动。"
        if focus
        else ""
    )
    if focus and life:
        note = (f"仅当「{focus}」承接玩家此刻的目标、已知线索或已生效的世界变化时，"
                "才能据此给出可选方向。玩家拒绝、离开或另有打算时，让事情自行发展。")
    used = len(main) + len(threads) + len("【剧情指导】") + 3 + (len(note) + 1 if note else 0)
    budget = INJECTION_LIMIT - used - sum(len(label) + 2 for label in labels)
    if focus:
        at = labels.index(focus)
        whole = _clip(texts[at], max(budget // 2, min(len(texts[at]), 120)))
        rest = _fill(texts[:at] + texts[at + 1 :], budget - len(whole))
        fitted = rest[:at] + [whole] + rest[at:]
    else:
        fitted = _fill(texts, budget)
    lines = [f"{label}：{text}" for label, text in zip(labels, fitted, strict=True) if text]
    advice = "【剧情指导】\n" + "\n".join(lines + ([note] if note else [])) if lines else ""
    block = "\n".join(part for part in (main, advice, threads) if part)
    return block[:INJECTION_LIMIT]


def opening_text(data):
    """Origin, fortune and world factors from the opening record (天道初启)."""
    for log in _logs(data):
        content = str(log.get("content") or "")
        if OPENING in content and not log.get("isGhost"):
            content = re.sub(
                r"<details>(?:(?!</details>)[\s\S])*?最终属性[\s\S]*?</details>", "", content
            )
            return _cut(clean_text(content), 1500)
    return ""


def _current(data):
    current = ((data or {}).get("state") or {}).get("currentState") or {}
    if isinstance(current, str):
        try:
            current = json.loads(current)
        except ValueError:
            current = {}
    return current if isinstance(current, dict) else {}


def _rows(table):
    if isinstance(table, dict):
        return [(str(key), row) for key, row in table.items() if isinstance(row, dict)]
    if isinstance(table, list):
        rows = [row for row in table if isinstance(row, dict)]
        return [(str(row.get("0") or row.get("id") or ""), row) for row in rows]
    return []


def _remarks(row):
    raw = row.get("9")
    if isinstance(raw, dict):
        return raw
    text = str(raw or "")
    if text.lstrip().startswith("{"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except ValueError:
            pass
    result = {}
    for part in text.split("|"):
        key, sep, value = part.partition(":")
        if sep and key.strip() and key.strip() not in result:
            result[key.strip()] = value.strip()
    return result


def _time_row(current):
    rows = current.get("4") or [{}]
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}
    return str(row.get("0") or "")


def game_time(data):
    return _time_row(_current(data)).split("/")[0].strip()


def _departed(data, people):
    names = []
    for entry in ((data or {}).get("state") or {}).get("worldBookEntries") or []:
        key = str(entry.get("key") or "") if isinstance(entry, dict) else ""
        if not re.match(r"[CG]", key) or key in people:
            continue
        status = ""
        try:
            content = entry.get("content")
            row = json.loads(content) if isinstance(content, str) else None
            status = _cut(row.get("4"), 12) if isinstance(row, dict) else ""
        except ValueError:
            pass
        status = "" if status in ("", "待定", "一切正常") else f"（{status}）"
        names.append(_cut(entry.get("title") or key, 16) + status)
    return names


def state_text(data):
    current = _current(data)
    people = dict(_rows(current.get("0")))
    sections = ["时间地点：" + (_cut(_time_row(current), 120) or "未知")]
    player = people.get("B1")
    if player:
        remarks = _remarks(player)
        facts = [
            f"{key}{_cut(remarks[key], 20)}"
            for key in ("灵根", "年龄", "寿元", "修为进度")
            if remarks.get(key)
        ]
        if str(player.get("26") or "").strip() not in ("", "待定"):
            facts.append(f"灵石{_cut(player.get('26'), 12)}")
        head = "，".join(_cut(player.get(k), 40) for k in ("1", "2", "4") if player.get(k))
        sections.append("主角：" + head + ("；" + "，".join(facts) if facts else ""))
    bag = "、".join(
        f"{_cut(row.get('1'), 16)}×{_cut(row.get('5') or 1, 6)}"
        for _, row in _rows(current.get("1"))
        if row.get("1")
    )
    sections.append("储物袋：" + (_cut(bag, 400) or "空"))
    skills = "、".join(_cut(row.get("1"), 16) for _, row in _rows(current.get("8")) if row.get("1"))
    if skills:
        sections.append("功法与技能：" + _cut(skills, 200))
    present = [
        f"{key} {_cut(row.get('1'), 20)}（{_cut(row.get('2'), 24)}）{_cut(row.get('4'), 24)}"
        for key, row in people.items()
        if key != "B1"
    ]
    sections.append("在场人物：" + (_cut("；".join(present), 800) or "无"))
    departed = _departed(data, people)
    if departed:
        sections.append("离场人物：" + _cut("、".join(departed), 300))
    quests = [
        f"{key} {_cut(row.get('1'), 20)}（{_cut(row.get('5'), 16)}）：{_cut(row.get('2'), 60)}"
        for key, row in _rows(current.get("6"))
        if row.get("1")
    ]
    sections.append("任务：" + (_cut("；".join(quests), 600) or "无"))
    events = current.get("5") if isinstance(current.get("5"), list) else []
    events = [
        f"{_cut(e.get('0'), 24)} {_cut(e.get('1'), 20)} {_cut(e.get('2'), 60)}".strip()
        for e in events[-5:]
        if isinstance(e, dict)
    ]
    if events:
        sections.append("最近的世界大事：" + _cut("；".join(events), 400))
    return _cut("\n".join(sections), STATE_LIMIT)


def story_window(logs, start):
    """The turns after index `start`, newest kept within the limit, and where they begin."""
    entries, action, number = [], "", 0
    for index, log in enumerate(logs):
        if is_turn(log):
            number += 1
        if index <= start:
            continue
        if log.get("type") == "user":
            action = clean_text(log.get("content")).lstrip(">").strip()
        elif is_turn(log):
            story = clean_text(log.get("content"))
            heading = f"【第{number}回合】玩家：{_cut(action, 300) or '（无）'}"
            entries.append((index, heading + "\n" + story))
            action = ""
    kept, used = [], 0
    for index, text in reversed(entries):
        if used + len(text) > STORY_LIMIT:
            room = STORY_LIMIT - used
            if room > 200 or not kept:
                kept.append((index, "……" + text[-max(room - 2, 1) :]))
            break
        kept.append((index, text))
        used += len(text) + 2
    kept.reverse()
    first = kept[0][0] if kept else len(logs)
    return "\n\n".join(text for _, text in kept), first


def earlier_summaries(logs, end):
    """Turn and deep summaries before the story window, newest kept within the limit."""
    items, number = [], 0
    for log in logs[: max(end, 0)]:
        if is_turn(log):
            number += 1
            small = clean_text(log.get("smallSummary"))
            large = clean_text(log.get("largeSummary"))
            if small or large:
                items.append(
                    (
                        f"第{number}回合：{_cut(small or large, 200)}",
                        f"第{number}回合：{_cut(large or small, 100)}",
                    )
                )
        elif log.get("isDeepSummary"):
            text = clean_text(log.get("largeSummary") or log.get("smallSummary"))
            if text:
                items.append((f"早先：{_cut(text, 300)}", f"早先：{_cut(text, 120)}"))
    out, used = [], 0
    for detailed, brief in reversed(items):
        text = detailed if used < SUMMARY_LIMIT * 0.6 else brief
        if used + len(text) + 1 > SUMMARY_LIMIT:
            break
        out.append(text)
        used += len(text) + 1
    return "\n".join(reversed(out))


def plot_text(plot, marks_source=None):
    lines = [
        f"个人主线《{plot.get('title')}》（{plot.get('status')}）",
        f"幕后真相：{plot.get('truth')}",
        f"引子：{plot.get('hook')}",
    ]
    current = current_index(plot)
    for index, chapter in enumerate(plot.get("chapters") or []):
        marks = chapter_marks(marks_source, chapter) if index == current else None
        judge = "由你判断" if index == current else "由剧情判断"
        goal = str(chapter.get("goal") or "").rstrip("。；;. ")
        lines.append(
            f"第{index + 1}章「{chapter.get('title')}」（{chapter.get('status')}）"
            f"目标：{goal}；条件：{conditions_text(chapter, marks, judge)}"
        )
    return "\n".join(lines)


def previous_text(run, disabled, marks_source=None):
    if not run:
        return "（还没有推演过）"
    guidance = run.get("guidance") or {}
    threads = [t for t in run.get("threads") or [] if isinstance(t, dict)]
    listed = "；".join(
        f"{t.get('id')} {t.get('text')}（第{t.get('since', '?')}回合埋下）" for t in threads
    )
    lines = [
        f"推演于第{run.get('turn', 0)}回合（{run.get('gameTime') or '时间未记'}）",
        "剧情指导：" + "；".join(f"{label}：{guidance.get(label, '')}" for _, label in GUIDANCE),
        "未回收的伏笔：" + (listed or "无"),
    ]
    plot = run.get("plot")
    if isinstance(plot, dict) and plot.get("chapters"):
        lines.append("（玩家已关闭个人主线）" if disabled else plot_text(plot, marks_source))
    return "\n".join(lines)


def cultivation_text(progress):
    if progress.get("progressText"):
        return _cut(progress["progressText"], 800)
    cultivation = progress.get("cultivation")
    if isinstance(cultivation, dict) and isinstance(cultivation.get("text"), str):
        return _cut(cultivation["text"], 800)
    if cultivation:
        return _cut(json.dumps(cultivation, ensure_ascii=False), 800)
    return "（引擎没有给出修行状态）"


# ------------------------------------------------------------------ write_plan checks


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def check_condition(raw, where):
    if not isinstance(raw, dict):
        return None, [f"{where}的格式无效"]
    kind = _text(raw.get("kind"))
    if kind not in KINDS:
        return None, [f"{where}的种类「{kind}」无效，只能是{'、'.join(KINDS)}"]
    value = raw.get("value")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(int(value))
    value = _text(value)
    count = raw.get("count")
    if isinstance(count, str) and count.strip().isdigit():
        count = int(count)
    errors = []
    if count is not None and (not isinstance(count, int) or isinstance(count, bool) or count < 1):
        errors.append(f"{where}的count必须是正整数")
        count = None
    if kind == "灵石":
        number = re.search(r"\d+", value)
        number = int(number[0]) if number else count
        if not number:
            return None, [*errors, f"{where}（灵石）要写数量"]
        value, count = str(number), None
    limit = 60 if kind == "其他" else 40
    if not value:
        errors.append(f"{where}的value不能为空")
    elif len(value) > limit:
        errors.append(f"{where}的value超过{limit}字")
    elif kind == "境界" and not any(name in value for name in REALMS):
        errors.append(f"{where}（境界）要写境界名，如炼气一层、筑基初期")
    elif kind == "日期":
        date = re.search(r"(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", value)
        if not date:
            errors.append(f"{where}（日期）要写游戏日期，如0001年03月01日")
        else:
            value = f"{int(date[1]):04d}年{int(date[2]):02d}月{int(date[3]):02d}日"
    condition = {"kind": kind, "value": value}
    if kind == "持有" and count:
        condition["count"] = count
    return condition, errors


def check_chapter(raw, number):
    where = f"第{number}章"
    if not isinstance(raw, dict):
        return None, [f"{where}的格式无效"]
    errors = []
    title, goal = _text(raw.get("title")), _text(raw.get("goal"))
    # The page numbers the chapters itself.
    title = re.sub(r"^第[一二三四五六七八九十\d]+章\s*[：:·、.\s]*", "", title) or title
    if not title or len(title) > 20:
        errors.append(f"{where}的title不能为空且不超过20字")
    if not goal or len(goal) > 80:
        errors.append(f"{where}的goal不能为空且不超过80字")
    raw_conditions = raw.get("conditions")
    if not isinstance(raw_conditions, list) or not 1 <= len(raw_conditions) <= 4:
        errors.append(f"{where}需要1到4个完成条件")
        raw_conditions = raw_conditions[:4] if isinstance(raw_conditions, list) else []
    conditions = []
    for index, item in enumerate(raw_conditions, 1):
        condition, problems = check_condition(item, f"{where}第{index}个条件")
        errors += problems
        if condition:
            conditions.append(condition)
    if raw_conditions and not any(c["kind"] != "其他" for c in conditions):
        errors.append(
            f"{where}至少要有一个由引擎判断的条件（境界、持有、到达、日期、倒下、任务、灵石）"
        )
    return {"title": title, "goal": goal, "conditions": conditions}, errors


def check_storyline(raw, mode, kept):
    errors, plot = [], {}
    if mode == "new":
        for key, limit, label in (
            ("title", 20, "标题"),
            ("truth", 200, "幕后真相"),
            ("hook", 100, "引子"),
        ):
            text = _text(raw.get(key))
            if not text:
                errors.append(f"plot.{key}（{label}）不能为空")
            elif len(text) > limit:
                errors.append(f"plot.{key}（{label}）超过{limit}字（现为{len(text)}字）")
            plot[key] = text
    raw_chapters = raw.get("chapters")
    if mode == "rewrite" and not raw_chapters:
        return None, []
    # Rewriting the current chapter too: it is replaced, not kept, and keeps its id.
    current = mode == "rewrite" and raw.get("rewrite_current") is True and kept > 0
    if current:
        kept -= 1
        plot["rewrite_current"] = True
    if not isinstance(raw_chapters, list) or not raw_chapters:
        return None, [*errors, "plot.chapters要写出章节"]
    total = kept + len(raw_chapters)
    if not 3 <= total <= 5:
        errors.append(
            f"连同保留的{kept}章，主线应为3到5章（现为{total}章）"
            if kept
            else f"plot.chapters需要3到5章（现为{total}章）"
        )
    chapters = []
    for number, item in enumerate(raw_chapters[: max(5 - kept, 0)], kept + 1):
        chapter, problems = check_chapter(item, number)
        errors += problems
        if chapter:
            chapters.append(chapter)
    plot["chapters"] = chapters
    return plot, errors


def check_plan(args, *, open_ids, mode, kept, required):
    """Validate write_plan's arguments; returns the normalized plan and the error list."""
    if not isinstance(args, dict):
        return None, ["write_plan的参数不是有效的JSON对象"]
    errors, guidance = [], {}
    raw = args.get("guidance")
    if not isinstance(raw, dict):
        errors.append("缺少guidance（明线、暗线、突发事件、登场人物）")
        raw = {}
    for key, label in GUIDANCE:
        text = _text(raw.get(key, raw.get(label)))
        if not text:
            errors.append(f"guidance.{key}（{label}）不能为空")
        elif len(text) > 200:
            errors.append(f"guidance.{key}（{label}）超过200字（现为{len(text)}字）")
        guidance[label] = text
    threads = args.get("new_threads") or []
    if not isinstance(threads, list):
        errors.append("new_threads必须是字符串列表")
        threads = []
    if len(threads) > 3:
        errors.append(f"new_threads最多3条（现为{len(threads)}条）")
    new_threads = []
    for index, item in enumerate(threads[:3], 1):
        text = re.sub(r"^\s*[FＦ]\s*\d+\s*[：:、.．)）]?\s*", "", _text(item))
        if not text or len(text) > 80:
            errors.append(f"new_threads第{index}条不能为空且不超过80字")
        else:
            new_threads.append(text)
    resolved = args.get("resolved") or []
    if not isinstance(resolved, list):
        errors.append("resolved必须是伏笔编号列表")
        resolved = []
    closed = []
    for item in resolved:
        key = _text(item).upper()
        if key not in open_ids:
            listed = "、".join(sorted(open_ids)) or "无"
            errors.append(
                f"resolved里的「{_cut(item, 20)}」不是未回收的伏笔编号（未回收：{listed}）"
            )
        elif key not in closed:
            closed.append(key)
    plot = None
    if mode != "none":
        raw_plot = args.get("plot")
        if raw_plot and isinstance(raw_plot, dict):
            plot, problems = check_storyline(raw_plot, mode, kept)
            errors += problems
        elif raw_plot:
            errors.append("plot必须是对象")
        if required and plot is None:
            errors.append("本次必须在plot里写出主线（title、truth、hook和章节）")
    raw_done = args.get("chapter_done")
    done = {"done": False, "why": ""}
    if isinstance(raw_done, dict):
        flag = raw_done.get("done")
        if isinstance(flag, str):
            flag = flag.strip().lower() in ("true", "是", "yes", "1")
        done = {"done": flag is True, "why": _cut(_text(raw_done.get("why")), 100)}
    plan = {
        "guidance": guidance,
        "new_threads": new_threads,
        "resolved": closed,
        "plot": plot,
        "chapter_done": done,
    }
    return plan, errors


def check_life(args):
    """WRITE_PLAN_LIFE's three kinds and its leads as lists of objects, and what is wrong with
    their shape. What is in them is the engine's to judge (its director op drops what breaks its
    rules)."""
    extras, errors = {}, []
    for key in LIFE_KEYS:
        items = args.get(key) if isinstance(args, dict) else None
        if items is None:
            items = []
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            errors.append(f"{key}必须是对象的列表，没有就给空列表")
            items = []
        extras[key] = copy.deepcopy(items)
    leads = args.get("leads") if isinstance(args, dict) else None
    if leads is None:
        leads = []
    if not isinstance(leads, list) or not all(isinstance(item, dict) for item in leads):
        errors.append("leads必须是对象的列表，没有就给空列表")
        leads = []
    extras["leads"] = copy.deepcopy(leads)
    claims = args.get("chapter_evidence") if isinstance(args, dict) else None
    extras["chapter_evidence"] = copy.deepcopy(claims[:4]) if isinstance(claims, list) else []
    return extras, errors


# ------------------------------------------------------------------ the run


def _get(item, key):
    return item.get(key) if isinstance(item, dict) else getattr(item, key, None)


def _echo_arguments(arguments):
    """A tool call's arguments as sent back to the model: gateways reject invalid JSON there."""
    try:
        json.loads(arguments or "{}")
        return arguments or "{}"
    except ValueError:
        return "{}"


def read_response(response):
    """(text, tool calls, finish reason) of a non-streaming completion."""
    choices = _get(response, "choices") or []
    if not choices:
        return "", [], None
    choice = choices[0]
    message = _get(choice, "message")
    text = _get(message, "content") if message is not None else ""
    calls = []
    raw_calls = (_get(message, "tool_calls") if message is not None else None) or []
    for index, call in enumerate(raw_calls):
        function = _get(call, "function")
        arguments = _get(function, "arguments") if function is not None else None
        if isinstance(arguments, dict):
            arguments = json.dumps(arguments, ensure_ascii=False)
        calls.append(
            {
                "id": _get(call, "id") or f"call_{index}",
                "name": (_get(function, "name") if function is not None else "") or "",
                "arguments": arguments or "{}",
            }
        )
    return (text if isinstance(text, str) else ""), calls, _get(choice, "finish_reason")


class Usage:
    def __init__(self):
        self.calls = 0
        self.prompt = 0
        self.completion = 0
        self.cost = 0.0
        self.reported = True
        self.ms = 0

    def add(self, response, seconds):
        self.calls += 1
        self.ms += round(seconds * 1000)
        usage = _get(response, "usage")
        if not usage:
            self.reported = False
        else:
            self.prompt += _int(_get(usage, "prompt_tokens"))
            self.completion += _int(_get(usage, "completion_tokens"))
            cost = _get(usage, "cost")
            if isinstance(cost, (int, float)):
                self.cost += float(cost)
        hidden = getattr(response, "_hidden_params", None)
        if isinstance(hidden, dict) and isinstance(hidden.get("response_cost"), (int, float)):
            self.cost += float(hidden["response_cost"])

    def snapshot(self):
        return {
            "calls": self.calls,
            "promptTokens": self.prompt,
            "completionTokens": self.completion,
            "cost": round(self.cost, 6),
            "usageReported": self.reported,
            "ms": self.ms,
        }


@dataclass
class Prepared:
    """What a run starts from: the save as read at the start and the effective run then."""

    value: dict
    archive_id: object
    logs: list
    positions: dict
    total: int
    source: dict
    base: dict | None
    start: int
    plot: dict | None
    disabled: bool
    mode: str
    index: int | None
    kept: int
    runs: list = field(default_factory=list)


def _numbers(values, prefix):
    found = [0]
    for value in values:
        match = re.fullmatch(prefix + r"(\d+)", str(value or ""), re.I)
        if match:
            found.append(int(match[1]))
    return max(found)


def _source(data, logs):
    turns = [log for log in logs if is_turn(log)]
    if turns:
        return turns[-1]
    for log in reversed(_logs(data)):
        if log.get("id") and log.get("type") != "user" and not log.get("isUndoSnapshot"):
            return log
    return None


def _mode(plot, disabled, total, reason):
    finished = plot is None or plot.get("status") == "已完结"
    if disabled or (total < MIN_PLOT_TURNS and finished):
        return "none"
    if finished:
        return "new"
    return "rewrite" if current_index(plot) is not None else "none"


def prepare(value, reason):
    data = value.get("data") or {}
    director = director_of(data)
    logs = expanded_logs(data)
    positions, total = turn_positions(logs)
    source = _source(data, logs)
    if source is None:
        raise DirectorError("还没有可以推演的回合")
    index = _effective_index(director["runs"], timeline_ids(data))
    base = director["runs"][index] if index is not None else None
    start = -1
    if base:
        start = next((i for i, log in enumerate(logs) if log.get("id") == base.get("logId")), -1)
        turns = [i for i, log in enumerate(logs) if is_turn(log)]
        if start < 0 and _int(base.get("turn")) > 0 and turns:
            start = turns[min(_int(base.get("turn")), len(turns)) - 1]
    plot = base.get("plot") if base else None
    plot = copy.deepcopy(plot) if isinstance(plot, dict) and plot.get("chapters") else None
    disabled = director["plotDisabled"]
    mode = _mode(plot, disabled, total, reason)
    position = current_index(plot)
    kept = position + 1 if mode == "rewrite" else 0
    return Prepared(
        value=value,
        archive_id=data.get("archiveId"),
        logs=logs,
        positions=positions,
        total=total,
        source=source,
        base=base,
        start=start,
        plot=plot,
        disabled=disabled,
        mode=mode,
        index=position,
        kept=kept,
        runs=director["runs"],
    )


STALLED_RUNS = 3


def stalled_runs(prep):
    """How many runs in a row, up to the effective one, found the current chapter in progress."""
    if prep.mode != "rewrite" or prep.index is None or not prep.base:
        return 0
    chapter = prep.plot["chapters"][prep.index].get("id")
    count = 0
    upto = prep.runs[: prep.runs.index(prep.base) + 1] if prep.base in prep.runs else []
    for run in reversed(upto):
        chapters = (run.get("plot") or {}).get("chapters") or []
        current = next((c for c in chapters if c.get("status") == "进行中"), None)
        if not current or current.get("id") != chapter:
            break
        count += 1
    return count


def task_text(prep, reason):
    lines = [f"本次推演发生在第{prep.total}回合之后，触发原因：{REASONS.get(reason, reason)}。"]
    if prep.disabled:
        lines.append("玩家关闭了本存档的个人主线：不写plot，chapter_done填否。")
    elif prep.mode == "new":
        lines.append(
            ("上一条主线已经完结。" if prep.plot else "当前还没有个人主线。")
            + "本次必须在plot里写出完整的新主线：title、truth、hook和3到5章，"
            "第一章就是现在开始的一章。chapter_done填否。"
        )
    elif prep.mode == "rewrite":
        number = prep.index + 1
        title = prep.plot["chapters"][prep.index].get("title")
        lines.append(
            f"主线进行中，当前是第{number}章「{title}」。按上面的条件达成情况判断这一章"
            f"是否完成，填写chapter_done。只有玩家实际走的路已经偏离后续章节时，才在"
            f"plot.chapters里重写第{number}章之后的章节（连同之前的共3到5章，title、truth"
            f"和hook不变）；玩家拒绝或连续几个回合不理第{number}章的目标时，把rewrite_current"
            f"设为true，chapters从改写后的第{number}章写起。否则不写plot。"
        )
        stalled = stalled_runs(prep)
        if stalled >= STALLED_RUNS:
            lines.append(
                f"第{number}章已经连续{stalled}次推演没有推进。先看玩家这些回合实际在做什么："
                f"若玩家没有朝这一章的目标走，就把rewrite_current设为true，按玩家正在走的路改写第{number}章"
                "（目标要是玩家眼下的行动能够达成的），让主线跟着玩家走；若玩家确实在朝目标努力，则保持不变。"
            )
    elif prep.total < MIN_PLOT_TURNS:
        lines.append("开局不足3回合，暂不生成主线：不写plot，chapter_done填否。")
    else:
        lines.append("不写plot，chapter_done填否。")
    if life_of(prep.value) is not None:
        lines.append(
            "修仙人生：按【钟、日历与待发生的事】的规矩，可在clocks、dated、pending里写下新起的压力钟、"
            "带日期的事和待发生的事，没有就给空列表；上面已有的不要重复。"
            "按世界事件的届次、阶段及玩家所知安排后续。错过或拒绝的事只发展后果，不换名再发同一机会。"
        )
    return "\n".join(lines)


def life_sections(play, progress):
    """What a save in the cultivation life adds to the director's input: today, the pressure
    clocks, the calendar ahead (the engine's progress mode reads these), the pending events, the
    leads (item 26), the open entries of the ledger and the heart knots (item 40; frxPlay's), each
    as a few lines."""
    life = progress.get("life") if isinstance(progress.get("life"), dict) else {}
    date = life.get("date") if isinstance(life.get("date"), dict) else {}
    clocks = [
        f"{item.get('id')} {item.get('name')}：{item.get('value')}/{item.get('size')}格"
        + (f"；{item['note']}" if item.get("note") else "")
        for item in life.get("clocks") or []
        if isinstance(item, dict)
    ]
    ahead = []
    for item in life.get("calendar") or []:
        if not isinstance(item, dict) or not isinstance(item.get("date"), dict):
            continue
        place = f"（{item['place']}）" if item.get("place") else ""
        when = item["date"].get("text")
        ahead.append(f"{when} {item.get('title')}{place}，还有{item.get('days')}日")
    hooks = []
    for item in play.get("pending") or []:
        trigger = item.get("trigger") if isinstance(item, dict) else None
        if not isinstance(trigger, dict):
            continue
        kind = PENDING_RULES["triggers"].get(trigger.get("kind"), trigger.get("kind"))
        seed = _cut(item.get("seed"), 120)
        hooks.append(f"{item.get('id')} 由头：{kind} {trigger.get('value')}；{seed}")
    leads = [
        f"{lead.get('id')} {'已查实' if lead.get('proven') else '未查实'}："
        f"{_cut(lead.get('line'), 40)}"
        + (f"（去{lead['where']}查）" if lead.get("where") else "")
        for lead in play.get("leads") or [] if isinstance(lead, dict)
    ]
    ledger = []
    for entry in play.get("karma") or []:
        if not isinstance(entry, dict) or entry.get("done") or entry.get("broken"):
            continue
        who = (entry.get("who") or {}).get("name") or ""
        due = f"；期限{entry['due']}" if entry.get("due") else ""
        ledger.append(f"{entry.get('id')} {entry.get('kind')}：{who}，{_cut(entry.get('what'), 60)}"
                      f"（第{entry.get('year')}年{due}）；{_cut(entry.get('back'), 40)}")
    knots = [
        f"{knot.get('id')} {knot.get('kind')}：{(knot.get('who') or {}).get('name') or ''}，"
        f"{_cut(knot.get('what'), 60)}（第{knot.get('year')}年）"
        for knot in play.get("knots") or [] if isinstance(knot, dict)
    ]
    evidence = life_evidence(play)
    matters = active_matters(play)
    if matters:
        evidence["goals"] = matters
    return [
        *([("各届世界事件、角色所知与已了结事项",
            json.dumps(evidence, ensure_ascii=False, separators=(",", ":")))]
          if evidence else []),
        ("今天", date.get("text") or "（读不出）"),
        ("压力钟", "\n".join(clocks) or "无"),
        ("日历", "\n".join(ahead) or "无"),
        ("待发生的事", "\n".join(hooks) or "无"),
        ("疑点", "\n".join(leads) or "无"),
        ("因果", "\n".join(ledger) or "无"),
        ("心结", "\n".join(knots) or "无"),
    ]


def build_messages(prep, reason, progress):
    data = prep.value.get("data") or {}
    story, first = story_window(prep.logs, prep.start)
    instructions = ((_current(data).get("state") or {}).get("latestPlotGuidance") or "").strip()
    sections = [
        ("玩家的指示（必须遵守）", _cut(instructions, 2000) or "无"),
        ("出身、先天气运与世界因子", opening_text(data) or "（开场记录缺失）"),
        ("当前状态", state_text(data)),
        ("修行状态", cultivation_text(progress)),
        ("更早的剧情摘要", earlier_summaries(prep.logs, first) or "无"),
        ("上次推演以来的正文", story or "（还没有新的正文）"),
        ("上一份推演", previous_text(prep.base, prep.disabled, progress.get("plot"))),
        ("本次任务", task_text(prep, reason)),
    ]
    play = life_of(prep.value)
    if play is not None:
        lore = regional_lore(prep.value, director=True)
        sections[-1:-1] = ([("地域世界书与推进机会", lore)] if lore else []) + life_sections(play, progress)
        if not prep.disabled and prep.plot and prep.index is not None:
            chapter = prep.plot["chapters"][prep.index]
            review = story_review_text(chapter, completed_story_facts(prep.value))
            if review:
                sections.append(("本章剧情条件的核验", review))
    user = "\n\n".join(f"【{title}】\n{body}" for title, body in sections)
    preset = DIRECTOR_PRESET if play is None else DIRECTOR_PRESET_LIFE
    return [{"role": "system", "content": preset}, {"role": "user", "content": user}]


def new_chapter(chapter, number, status):
    return {
        "id": f"c{number}",
        "title": chapter["title"],
        "goal": chapter["goal"],
        "status": status,
        "conditions": copy.deepcopy(chapter["conditions"]),
    }


def _judge(chapter, met, claim):
    """Engine conditions and linked facts must hold; the model can judge unlinked story goals."""
    claimed, why = claim["done"], claim["why"]
    if not met:
        if not claimed:
            return False, why
        return False, "由引擎判断的条件尚未全部达成" + (f"；{why}" if why else "")
    if not any(c.get("kind") == "其他" and not c.get("evidence")
               for c in chapter.get("conditions") or []):
        return True, why or "完成条件已全部达成"
    return bool(claimed), why


def settle_plan(prep, plan, progress_plot, turn):
    """The threads, the storyline and the chapter judgement after this run."""
    runs = prep.runs
    resolved = set(plan["resolved"])
    serial = _numbers(
        [t.get("id") for run in runs for t in run.get("threads") or [] if isinstance(t, dict)]
        + [key for run in runs for key in run.get("resolved") or []],
        "F",
    )
    base_threads = [t for t in (prep.base or {}).get("threads") or [] if isinstance(t, dict)]
    threads = [t for t in base_threads if t.get("id") not in resolved]
    for offset, text in enumerate(plan["new_threads"], 1):
        threads.append({"id": f"F{serial + offset}", "text": text, "since": turn})
    threads = threads[-MAX_OPEN_THREADS:]
    plot = copy.deepcopy(prep.plot)
    judgement, met_at_run = None, False
    written = plan["plot"]
    # Chapter ids are never reused within a save: the engine records paid chapter rewards by id.
    plots = [run.get("plot") or {} for run in runs] + [plot or {}]
    serial = _numbers([c.get("id") for p in plots for c in p.get("chapters") or []], "c")
    if prep.mode == "new" and written:
        number = _numbers([p.get("id") for p in plots], "P") + 1
        plot = {
            "id": f"P{number}",
            "title": written["title"],
            "truth": written["truth"],
            "hook": written["hook"],
            "status": "进行中",
            "chapters": [
                new_chapter(chapter, serial + n, "进行中" if n == 1 else "待开始")
                for n, chapter in enumerate(written["chapters"], 1)
            ],
        }
    elif prep.mode == "rewrite" and plot:
        chapter = plot["chapters"][prep.index]
        life = life_of(prep.value) is not None
        marks = chapter_marks(progress_plot, chapter)
        if life:
            claims = (plan.get("life") or {}).get("chapter_evidence") or []
            marks = attach_evidence(chapter, claims, completed_story_facts(prep.value), marks)
        if written and written.get("rewrite_current") and written["chapters"]:
            # The player went another way: the current chapter follows them, under its own
            # id (a reward is paid once per id), and is not judged this run.
            first, *later = written["chapters"]
            conditions = copy.deepcopy(first["conditions"])
            evidence = {c.get("value"): c["evidence"] for c in chapter.get("conditions") or []
                        if c.get("kind") == "其他" and c.get("evidence")}
            for condition in conditions:
                value = condition.get("value")
                if condition.get("kind") == "其他" and value in evidence:
                    condition["evidence"] = evidence[value]
            chapter.update(title=first["title"], goal=first["goal"], status="进行中",
                           conditions=conditions)
            plot["chapters"] = plot["chapters"][: prep.index + 1] + [
                new_chapter(item, serial + n, "待开始") for n, item in enumerate(later, 1)
            ]
            judgement = {"done": False, "why": "当前一章已按玩家的选择改写"}
            return threads, plot, judgement, False
        met = all_met(chapter, marks)
        done, why = _judge(chapter, met, plan["chapter_done"])
        judgement = {"done": done, "why": why}
        if written:
            plot["chapters"] = plot["chapters"][: prep.index + 1] + [
                new_chapter(item, serial + n, "待开始")
                for n, item in enumerate(written["chapters"], 1)
            ]
        if done:
            plot["chapters"][prep.index].update(status="已完成", doneAt=turn)
            if prep.index + 1 < len(plot["chapters"]):
                plot["chapters"][prep.index + 1]["status"] = "进行中"
            else:
                plot["status"] = "已完结"
        else:
            # Seen with its engine conditions met but not done: the chapter trigger waits.
            met_at_run = met
    return threads, plot, judgement, met_at_run


def life_leads(plan, prep, threads, plot):
    """WRITE_PLAN_LIFE's leads as the engine's director op takes them (plan item 26): each
    against an open thread after this run (its id, or 新N for this run's Nth new thread; any
    other is left out), with the chapter it is written in (the current one after the run) and the
    threads this run resolved, whose leads come out proven by the story."""
    base = {t.get("id") for t in (prep.base or {}).get("threads") or [] if isinstance(t, dict)}
    fresh = [t.get("id") for t in threads if t.get("id") not in base]
    open_ids = {t.get("id") for t in threads}
    leads = []
    for item in (plan.get("life") or {}).get("leads") or []:
        ref = str(item.get("thread") or "").strip()
        new = re.fullmatch(r"新(\d+)", ref)
        thread = fresh[int(new[1]) - 1] if new and 0 < int(new[1]) <= len(fresh) else ref
        if thread in open_ids:
            leads.append({"id": thread, "line": _clip(str(item.get("line") or ""), 40),
                          "where": _clip(str(item.get("where") or ""), 20)})
    index = current_index(plot) if plot else None
    chapter = plot["chapters"][index] if index is not None else {}
    return {"leads": leads, "leadChapter": chapter.get("id"), "leadTitle": chapter.get("title"),
            "resolved": [str(key) for key in plan.get("resolved") or []]}


# ------------------------------------------------------------------ the cultivation life's run

LIFE_UNADMITTED = "剧情演化的模型没有通过工具准入，这一步不跑：钟和待发生的事只来自引擎自己的规则"


def closed_scene(records, log):
    """Whether the committed turn of this log closed a scene: its request's settlement holds the
    close card's receipt (apps/engine/life/scene.cjs)."""
    request_id = log.get("frxRequestId") if isinstance(log, dict) else None
    if not request_id:
        return False
    try:
        settlement = records.request(request_id).get("settlement") or {}
    except HTTPException:
        return False
    return any(
        isinstance(receipt, dict) and receipt.get("kind") == "close" and receipt.get("ok")
        for receipt in settlement.get("receipts") or []
    )


def write_play(records, name, archive_id, digest, play):
    """Write a life run's frxPlay into the save without raising its version, as frxDirector is
    written: "written"; "busy" while a turn of the save is under way (a turn commits from the
    state it reserved, and a write meanwhile would refuse its reply); "moved" when the save's
    state is no longer the one the engine read (`digest`); "gone" when the save is not there or
    is another one now."""
    with records.sessions.begin() as session:
        records.lock(session)
        row = records.record(session, "archives", name, lock=True)
        value = row.value if row else None
        data = value.get("data") if isinstance(value, dict) else None
        if not isinstance(data, dict) or data.get("archiveId") != archive_id:
            return "gone"
        if records.turn_under_way(session, name):
            return "busy"
        if state_digest(data.get("state") or {}) != digest:
            return "moved"
        state = {**data["state"], "frxPlay": copy.deepcopy(play)}
        row.value = {**value, "data": {**data, "state": state}}
        return "written"


_BACKGROUND = set()


def _track(task, owner=None):
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)
    if owner is not None:
        owner.add(task)
        task.add_done_callback(owner.discard)


async def drain():
    """Wait until this event loop's background checks and runs have finished (tests)."""
    loop = asyncio.get_running_loop()
    while True:
        pending = [task for task in _BACKGROUND if task.get_loop() is loop and not task.done()]
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)


class Director:
    """Runs plot evolution for each save in the background, one run per save at a time.

    One director serves every user. Runs are registered by (user, save name), so two players'
    saves of the same name never hold each other back, and a run reads and writes only through
    its own user's store and settings. recall(user_id, value, args) searches that user's memory.
    `meter` (frx.usage) records each run's usage under its user, and a player at a usage limit
    gets no run: the attempt is recorded as skipped, with the reason.
    """

    def __init__(self, sessions, profiles, recall=None, meter=None):
        self.sessions = sessions
        self.profiles = profiles
        self.recall = recall
        self.meter = meter
        self.running = {}
        self.tasks = set()

    def records(self, user_id):
        return CardStore(user_id, self.sessions)

    def is_running(self, user_id, name):
        return (user_id, name) in self.running

    # ---------------------------------------------------------- ownership and settings

    def server_owned(self):
        """The server runs plot evolution while the evolution model has passed tool admission."""
        return tool_capable(self.profiles.load("evolution").model)

    def settings(self, user_id, owned=None):
        records = self.records(user_id)
        with records.sessions() as session:
            config = records.setting_value(session, SETTINGS_KEY)
        return director_settings(config, self.server_owned() if owned is None else owned)

    # ---------------------------------------------------------- triggers

    def after_commit(self, user_id, name):
        """Schedule a trigger check after a turn committed; never fails the caller."""
        try:
            task = asyncio.get_running_loop().create_task(self.check(user_id, name))
        except RuntimeError:
            return
        _track(task, self.tasks)

    async def check(self, user_id, name):
        try:
            if self.is_running(user_id, name) or not self.server_owned():
                return
            settings = await asyncio.to_thread(self.settings, user_id, True)
            if not settings["enabled"]:
                return
            records = self.records(user_id)
            value = (await asyncio.to_thread(records.get, "archives", name, lean=True))["value"]
            if not value or not isinstance(value.get("data"), dict):
                return
            if life_of(value) is not None:
                reason = await self.life_trigger(records, value)
            else:
                reason = await self.trigger(value, settings["frequency"])
            if reason:
                self.start(user_id, name, reason)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("director_check_failed error=%s", type(error).__name__)

    async def trigger(self, value, frequency):
        """Why a run is due after this commit, or None."""
        data = value["data"]
        director = director_of(data)
        logs = expanded_logs(data)
        positions, total = turn_positions(logs)
        index = _effective_index(director["runs"], timeline_ids(data))
        run = director["runs"][index] if index is not None else None
        last = director["lastAttempt"] or {}
        if last.get("status") == "failed" and last.get("logId") in positions:
            # A failed attempt holds the automatic ones back for another round of turns.
            if total - positions[last["logId"]] < frequency:
                return None
        if turns_since(data, run, logs) >= frequency:
            return "frequency"
        plot = active_plot(data)
        position = current_index(plot)
        if run is None or run.get("metAtRun") or position is None:
            return None
        progress = await engine_progress(value, plot)
        chapter = plot["chapters"][position]
        if all_met(chapter, chapter_marks(progress.get("plot"), chapter)):
            return "chapter"
        return None

    async def life_trigger(self, records, value):
        """Why a run is due after this commit of a save in the cultivation life, or None. Never
        by the count of turns, and never after a turn the engine settled alone (a verb): when
        the current chapter's engine conditions are met, when its story evidence needs checking,
        or after the first scene that closes once a month has seen something (frxPlay.directorDue).
        """
        data = value["data"]
        turns = [log for log in expanded_logs(data) if is_turn(log)]
        if not turns or turns[-1].get("frxKind") == "chronicle":
            return None
        director = director_of(data)
        runs = director["runs"]
        ids = timeline_ids(data)
        index = _effective_index(runs, ids)
        plot = active_plot(data)
        position = current_index(plot)
        if index is not None and not runs[index].get("metAtRun") and position is not None:
            progress = await engine_progress(value, plot)
            chapter = plot["chapters"][position]
            if all_met(chapter, chapter_marks(progress.get("plot"), chapter)):
                return "chapter"
        review = story_review(plot, completed_story_facts(value))
        latest = director.get("lastAttempt") or {}
        previous = runs[index].get("storyReview") if index is not None else None
        attempted = latest.get("storyReview") if latest.get("logId") in ids else None
        if review and review not in (previous, attempted):
            return "evidence"
        if life_of(value).get("directorDue") and await asyncio.to_thread(
            closed_scene, records, turns[-1]
        ):
            return "month"
        return None

    def start(self, user_id, name, reason):
        """Start a run unless one is already going for this user's save."""
        key = (user_id, name)
        if key in self.running:
            return False
        task = asyncio.get_running_loop().create_task(self.run(user_id, name, reason))
        self.running[key] = task

        def finished(_):
            if self.running.get(key) is task:
                self.running.pop(key, None)

        task.add_done_callback(finished)
        _track(task, self.tasks)
        return True

    # ---------------------------------------------------------- the run

    async def complete(self, config, messages, tools, usage, state):
        """One model call; an upstream error gets one retry per run."""
        while True:
            started = time.monotonic()
            try:
                response = await Gateway.complete(
                    config,
                    messages,
                    tools=tools,
                    tool_choice="required",
                    max_tokens=8000,
                    temperature=0.7,
                    timeout=MODEL_SECONDS,
                )
            except ModelFailure as error:
                if state["retried"]:
                    raise DirectorError(str(error) or "模型请求失败") from None
                state["retried"] = True
                continue
            usage.add(response, time.monotonic() - started)
            return response

    async def recall_round(self, user_id, messages, echo, calls, value):
        messages.append(echo)
        for number, call in enumerate(calls):
            receipt = {"ok": False, "summary": "本轮只执行查旧事，请随后调用write_plan"}
            if call["name"] == "recall_memory" and number < 2 and self.recall:
                try:
                    args = json.loads(call["arguments"] or "{}")
                except ValueError:
                    args = {}
                receipt = await self.recall(user_id, value, args if isinstance(args, dict) else {})
            content = tool_message(receipt)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})

    @staticmethod
    def repair_round(messages, echo, calls, plan_call, text, errors):
        ask = "；".join(errors) + "。请调用write_plan提交完整结果。"
        if not calls:
            messages += [
                {"role": "assistant", "content": text or ""},
                {"role": "user", "content": ask},
            ]
            return
        messages.append(echo)
        for call in calls:
            content = (
                {"ok": False, "错误": errors, "要求": "逐条修正以上错误，重新调用write_plan"}
                if call is plan_call
                else {"ok": False, "结果": "未执行"}
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(content, ensure_ascii=False),
                }
            )
        if plan_call is None:
            messages.append({"role": "user", "content": ask})

    async def converse(self, user_id, config, messages, prep, memory, usage, validate=None,
                       life=False):
        """Round one may recall old memories; the last round must call write_plan. A plan that
        fails the checks (and `validate`, which can read the engine) gets one repair round with
        the error list. A save in the cultivation life is offered WRITE_PLAN_LIFE, and its plan
        carries the three new kinds as `life`."""
        plan_tool = WRITE_PLAN_LIFE if life else WRITE_PLAN
        tools = [TOOL_SPECS["recall_memory"], plan_tool] if memory else [plan_tool]
        state = {"retried": False}
        recalled = repaired = False
        threads = (prep.base or {}).get("threads") or []
        open_ids = {t.get("id") for t in threads if isinstance(t, dict)} - {None}
        while True:
            response = await self.complete(config, messages, tools, usage, state)
            text, calls, finish = read_response(response)
            plan_call = next((c for c in calls if c["name"] == "write_plan"), None)
            echo = {
                "role": "assistant",
                "content": text or None,
                "tool_calls": [
                    {
                        "id": c["id"],
                        "type": "function",
                        "function": {
                            "name": c["name"],
                            "arguments": _echo_arguments(c["arguments"]),
                        },
                    }
                    for c in calls
                ],
            }
            wants_recall = any(c["name"] == "recall_memory" for c in calls)
            if plan_call is None and memory and not recalled and wants_recall:
                recalled = True
                await self.recall_round(user_id, messages, echo, calls, prep.value)
                tools = [plan_tool]
                continue
            if plan_call is None:
                errors = ["没有调用write_plan提交结果"]
                if finish == "length":
                    errors.append("输出达到长度上限被截断")
            else:
                try:
                    args = json.loads(plan_call["arguments"] or "{}")
                except ValueError:
                    args = None
                plan, errors = check_plan(
                    args,
                    open_ids=open_ids,
                    mode=prep.mode,
                    kept=prep.kept,
                    required=prep.mode == "new",
                )
                if life and plan is not None:
                    plan["life"], problems = check_life(args)
                    plan["lifeKeys"] = [key for key in LIFE_KEYS if key in args]
                    errors = errors + problems
                if not errors and validate:
                    errors = await validate(plan)
                if not errors and not repaired:
                    # Asked for once: a repaired plan that still cites none is taken as it is.
                    errors = uncited_threads(plan, open_ids)
                if not errors:
                    return plan
            if repaired:
                raise DirectorError("推演结果两次未通过校验：" + "；".join(errors[:6]))
            repaired = True
            tools = [plan_tool]
            self.repair_round(messages, echo, calls, plan_call, text, errors)

    def has_memory(self, user_id, data):
        live = {log.get("id") for log in _logs(data)}
        return any(
            live_memory(value, data.get("archiveId"), live)
            for value in self.records(user_id).archive_memories(data.get("archiveId"))
        )

    async def run(self, user_id, name, reason):
        """One run; its memory searches are the user's, and so is its usage (one event)."""
        usage = Usage()
        try:
            with usage_scope(self.meter, user_id, "director"):
                await self.run_with(user_id, name, reason, usage)
        finally:
            if self.meter is not None:
                self.meter.record_metrics(user_id, "director", "evolution", usage.snapshot())

    async def run_with(self, user_id, name, reason, usage):
        started = time.monotonic()
        attempt = {"at": now(), "status": "failed", "reason": reason, "error": None}
        archive_id, config = None, None
        records = self.records(user_id)
        try:
            async with asyncio.timeout(RUN_SECONDS) as budget:
                value = (await asyncio.to_thread(records.get, "archives", name))["value"]
                if not value or not isinstance(value.get("data"), dict):
                    return
                archive_id = value["data"].get("archiveId")
                life = life_of(value) is not None
                prep = prepare(value, reason)
                turn = prep.positions.get(prep.source.get("id"), 0)
                attempt.update(logId=prep.source.get("id"), turn=turn)
                review = (story_review(prep.plot, completed_story_facts(value))
                          if life and not prep.disabled else None)
                if review:
                    attempt["storyReview"] = review
                if self.meter is not None:
                    problem = await asyncio.to_thread(self.meter.check_user_id, user_id)
                    if problem:
                        raise DirectorSkipped(problem[0] + "；这次剧情推演没有运行")
                config = self.profiles.load("evolution")
                if not config.model:
                    raise DirectorError("没有配置剧情演化模型")
                attempt["model"] = config.model
                if life and not tool_capable(config.model):
                    raise DirectorSkipped(LIFE_UNADMITTED)
                engine_plot = prep.plot if prep.plot and not prep.disabled else None
                progress = await engine_progress(value, engine_plot)
                memory = bool(self.recall) and await asyncio.to_thread(
                    self.has_memory, user_id, value["data"]
                )
                messages = build_messages(prep, reason, progress)
                async def fresh_chapters(candidate):
                    return await fresh_chapter_errors(value, prep, candidate, progress, turn)

                plan = await self.converse(
                    user_id, config, messages, prep, memory, usage, fresh_chapters, life=life
                )
                threads, plot, judgement, met_at_run = settle_plan(
                    prep, plan, progress.get("plot"), turn
                )
                run = {
                    "id": uuid4().hex[:12],
                    "logId": prep.source.get("id"),
                    "turn": turn,
                    "gameTime": game_time(value["data"]),
                    "at": now(),
                    "model": config.model,
                    "usage": usage.snapshot(),
                    "reason": reason,
                    "guidance": plan["guidance"],
                    "threads": threads,
                    "resolved": plan["resolved"],
                    "plot": plot,
                    "chapterJudgement": judgement,
                    "metAtRun": met_at_run,
                    **({"storyReview": review} if review else {}),
                }
                if life:
                    # A chapter judged done in this run adds 心境 (plan item 36), once.
                    done = (plot["chapters"][prep.index].get("id")
                            if prep.mode == "rewrite" and (judgement or {}).get("done") else None)
                    # The threads' leads (item 26): kept on the threads, and the engine's to keep
                    leads = life_leads(plan, prep, threads, plot)
                    for lead in leads["leads"]:
                        thread = next(t for t in threads if t.get("id") == lead["id"])
                        thread.update(line=lead["line"], where=lead["where"])
                    run["life"] = await self.apply_life(
                        user_id, name, archive_id, plan, prep.source.get("id"),
                        budget.when() - LIFE_SPARE_SECONDS, chapter=done, leads=leads,
                    )
                elapsed = round((time.monotonic() - started) * 1000)
                attempt.update(usage=usage.snapshot(), ms=elapsed)
                await asyncio.to_thread(self.save, user_id, name, archive_id, run, attempt)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if isinstance(error, DirectorError):
                attempt["error"] = str(error)
            elif isinstance(error, TimeoutError):
                attempt["error"] = "推演超时"
            else:
                logger.warning("director_run_failed error=%s", type(error).__name__)
                attempt["error"] = "推演失败，请查看本地服务日志"
            if isinstance(error, DirectorSkipped) or (
                attempt.get("logId") is None and isinstance(error, DirectorError)
            ):
                attempt["status"] = "skipped"
            attempt.update(usage=usage.snapshot(), ms=round((time.monotonic() - started) * 1000))
            if config is not None and config.model:
                attempt["model"] = config.model
            if archive_id is not None or attempt.get("logId") is not None:
                try:
                    await asyncio.to_thread(self.save, user_id, name, archive_id, None, attempt)
                except Exception as late:
                    logger.warning("director_record_failed error=%s", type(late).__name__)

    async def apply_life(self, user_id, name, archive_id, plan, log_id, until=None, chapter=None,
                         leads=None):
        """A life run's clocks, dated and pending events through the engine's director op, and
        the op's frxPlay written into the save with directorDue cleared (write_play: no version
        raised, only while no turn of the save is under way, on the save as it is then, the op
        run again when the save moved meanwhile). What the engine dropped is logged. Returns
        what the run keeps of it: given (how many of each kind the model wrote), keys (the
        kinds it wrote at all), taken, dropped and chronicle, or error. It waits no longer than
        LIFE_HOLD_SECONDS, nor past `until` (the loop's clock: the run's own time limit).
        `chapter` is the id of a chapter this run judged done: the op adds its 心境 (mind); `leads`
        the run's leads, chapter and resolved threads (life_leads), for the op's leads (item 26)."""
        records = self.records(user_id)
        extras = plan.get("life") or {key: [] for key in LIFE_KEYS}
        outcome = {"given": {key: len(extras.get(key) or []) for key in LIFE_KEYS},
                   "keys": list(plan.get("lifeKeys") or [])}
        loop = asyncio.get_running_loop()
        deadline = loop.time() + LIFE_HOLD_SECONDS
        if until is not None:
            deadline = min(deadline, until)
        moved = 0
        while True:
            value = (await asyncio.to_thread(records.get, "archives", name))["value"]
            data = value.get("data") if isinstance(value, dict) else None
            if not isinstance(data, dict) or data.get("archiveId") != archive_id or (
                life_of(value) is None
            ):
                return {**outcome, "error": "存档已变化，钟和待发生的事没有写入"}
            if log_id not in timeline_ids(data):
                return {**outcome, "error": "来源回合已不在当前时间线上，钟和待发生的事没有写入"}
            args = {**extras, "leads": [], **({"chapter": chapter} if chapter else {}),
                    **(leads or {})}
            payload = {"mode": "life", "op": "director", "archive": value, "args": args,
                       "seed": "director"}
            result = await card_turns.run_engine(payload)
            if result.get("error") or result.get("errors"):
                return {**outcome, "error": "引擎没有收下这次推演的钟和待发生的事"}
            before = life_of(value)
            play = copy.deepcopy(before)
            for receipt in result.get("receipts") or []:
                if isinstance(receipt, dict) and isinstance(receipt.get("frxPlay"), dict):
                    play = copy.deepcopy(receipt["frxPlay"])
            play.pop("directorDue", None)
            written = "written"
            if play != before:
                written = await asyncio.to_thread(
                    write_play, records, name, archive_id, state_digest(data["state"]), play
                )
            if written == "written":
                dropped = list(result.get("dropped") or [])
                for item in dropped:
                    logger.warning("director_life_dropped kind=%s name=%s reason=%s",
                                   item.get("kind"), item.get("name"), item.get("reason"))
                return {**outcome, "taken": result.get("taken") or {}, "dropped": dropped,
                        "chronicle": [line.get("line") for line in result.get("chronicle") or []],
                        **({"mind": result["mind"]} if result.get("mind") else {})}
            moved += written == "moved"
            if written == "gone" or moved > LIFE_MOVES:
                return {**outcome, "error": "存档已变化，钟和待发生的事没有写入"}
            if loop.time() > deadline:
                return {**outcome, "error": "回合一直在进行，钟和待发生的事没有写入"}
            if written == "busy":
                await asyncio.sleep(LIFE_HOLD_POLL)

    def save(self, user_id, name, archive_id, run, attempt):
        def change(data, director):
            if run is not None and run["logId"] in timeline_ids(data):
                director["runs"] = (director["runs"] + [run])[-MAX_RUNS:]
                attempt.update(status="ok", error=None, runId=run["id"])
            elif run is not None:
                attempt.update(
                    status="skipped",
                    error="来源回合已不在当前时间线上（可能已撤回），本次推演结果未采用",
                )
            director["lastAttempt"] = attempt
            return attempt

        return update_director(self.records(user_id), name, archive_id, change)

    # ---------------------------------------------------------- status and player controls

    def describe(self, user_id, name, value, settings, owned):
        data = (value or {}).get("data") or {}
        director = director_of(data)
        index = _effective_index(director["runs"], timeline_ids(data))
        run = director["runs"][index] if index is not None else None
        effective = None
        if run:
            effective = {
                "id": run.get("id"),
                "turn": run.get("turn"),
                "gameTime": run.get("gameTime"),
                "reason": run.get("reason"),
                "guidance": copy.deepcopy(run.get("guidance") or {}),
                "threads": copy.deepcopy(run.get("threads") or []),
                "plot": None if director["plotDisabled"] else public_plot(run.get("plot")),
            }
        return {
            "serverOwned": owned,
            "enabled": settings["enabled"],
            "frequency": settings["frequency"],
            "chosen": settings["chosen"],
            "running": self.is_running(user_id, name),
            "turnsSince": turns_since(data, run),
            "lastAttempt": copy.deepcopy(director["lastAttempt"]),
            "plotDisabled": director["plotDisabled"],
            "effective": effective,
        }

    def status(self, user_id, name, value=None):
        """The status object, or None when the save does not exist (run it in a thread)."""
        if value is None:
            value = self.records(user_id).get("archives", name)["value"]
        if not value:
            return None
        owned = self.server_owned()
        return self.describe(user_id, name, value, self.settings(user_id, owned), owned)

    def set_plot_disabled(self, user_id, name, archive_id, disabled):
        def change(data, director):
            director["plotDisabled"] = bool(disabled)
            return True

        return update_director(self.records(user_id), name, archive_id, change)


def committed_turns(value):
    """Committed turns on the save's timeline (the storyline needs a few first)."""
    return turn_positions(expanded_logs((value or {}).get("data") or {}))[1]
