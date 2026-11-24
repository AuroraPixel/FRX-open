"""The model's side of a scene's beat in the cultivation life (docs/gameplay-plan.md, 「行动卡」;
items 7 and 9): the action cards it hands back after the story, the scene's name on the first
beat and the close with its weight.

    <actions>
    [交涉|请长老为你护法|C2|难||结盟：请长老答应守住洞口]
    [买卖|买下聚气散|聚气散|||取得：购得闭关所需的聚气散]
    </actions>
    <scene>石阶上的来客</scene>   <close>中</close>
    <threads>
    [赴暗巷的闭门小易|齐管事||西坊暗巷|0001年 03月 15日 23:00~0001年 03月 16日 01:00|信牌]
    </threads>

parse_actions reads the cards ({ kind, title, target, tier, gate }, the engine's `cards` op prices
them). In a light scene (a small matter, batch 8) each card is followed by its two lines, what
comes of it done (成：) and not (败：), kept as the card's `said`, and the block has one line for
leaving it (离：, leave_line); the server writes the line for the card taken in place of a beat.
When there is no <actions> block with a card in it, the reply's <branches> sentences are the
cards, kind left empty for the engine to sort (its classify) and `fallback` true. The reply kept in
the save and on the request has none of the life's tags: its cards are its <branches> (their
titles), so the history and the old readers find what they always found (kept_reply).
threads_of reads the story threads a beat leaves (batch 9: <threads>, one a line,
[事|人|地点|具体处|起~止|要带的东西]) for the engine's thread op, which checks them against the save
(threads.cjs).
"""

import re

from .play_blocks import OPTION_LETTER, branch_options, plain, story_of
from .play_state import calendar_words

ACTIONS = re.compile(r"<actions\s*>([\s\S]*?)(?:</actions\s*>|$)", re.I)
SCENE = re.compile(r"<scene\s*>([\s\S]*?)</scene\s*>", re.I)
CLOSE = re.compile(r"<close\s*>([\s\S]*?)</close\s*>", re.I)
# The 回目 at a scene's close, and the 卷末语 of a volume a gate closed (item 38).
TITLE = re.compile(r"<title\s*>([\s\S]*?)</title\s*>", re.I)
VOLUME = re.compile(r"<volume\s*>([\s\S]*?)(?:</volume\s*>|$)", re.I)
BRANCHES = re.compile(r"<branches\s*>[\s\S]*?(?:</branches\s*>|$)", re.I)
# The story threads a beat leaves (batch 9).
THREADS = re.compile(r"<threads\s*>([\s\S]*?)(?:</threads\s*>|$)", re.I)
# One card: a bracketed line, its fields split by a bar (full width too).
CARD = re.compile(r"[\[［【]([^\[\]［］【】\n]+)[\]］】]")
FIELDS = re.compile(r"\s*[|｜]\s*")
# Unopposed refusal or withdrawal of one's own offer. Other route names in the action
# slot can imply very different costs (e.g. 取得 by trading or by taking it by force).
DECLINE = re.compile(r"^(?:谢绝|婉拒|推辞|不接|辞去|放弃|撤回报价"
                     r"|(?:收回|收起).{1,10}(?:另寻|离开|告辞))")

# The life's tags, gone from the kept reply.
LIFE_TAGS = re.compile(r"<(actions|scene|close|title|volume|threads)\s*>[\s\S]*?(?:</\1\s*>|$)",
                       re.I)


# The difficulties a card's fourth field takes (content/checks.json's tiers).
TIERS = ("易", "中", "难", "极难")
# Common synonyms for the optional route label; the kind and the action itself are untouched.
ROUTE_ALIASES = {"脱身": "转移", "撤离": "转移", "获取": "取得"}
# A light scene's lines (batch 8): after a card, what comes of it done and not; in the block, the
# line for leaving the scene. The engine holds them to their length (scene.json light.said).
SAID = re.compile(r"^\s*(成|败|离)\s*[：:]\s*(.+?)\s*$")


def cards_in(block):
    """The cards of an <actions> block's text: [{ kind, title, target, tier, gate, said? }]. A
    difficulty written in the target's place with none after it ([潜行|借风雪绕往石坑设伏|难], a
    live run of batch 6) is the difficulty, and the card has no target. A card followed by a 成：
    and a 败： line has them as `said` { success, failure } (a light scene's)."""
    cards = []
    for line in str(block or "").splitlines():
        found = CARD.findall(line)
        for each in found:
            parts = [plain(part).strip() for part in FIELDS.split(each)]
            if len(parts) < 2 or not parts[0] or not parts[1]:
                cards.append(None)
                continue
            # A route is always the last field. Accept omitted empty slots before it, as
            # for the old gate and difficulty. The validator checks its name and intent.
            route = (re.fullmatch(r"([^：:|｜]{1,8})[：:](.*)", parts[-1])
                     if len(parts) > 2 else None)
            extra = {}
            if route:
                parts.pop()
                intent = route[2].strip()
                question, arrow, decision = intent.partition("→")
                if arrow and decision.strip(" 。") in {
                    "查清后能作的决定", "查清后可作的决定", "据此可作的不同决定", "后续决定",
                }:
                    # A copied format hint supplies no downstream decision. An all-query set
                    # must still pass route_errors with two real ones.
                    intent = question.rstrip()
                label = route[1].strip()
                extra = {"route": ROUTE_ALIASES.get(label, label), "intent": intent}
            parts += [""] * (5 - len(parts))
            kind, title, target, tier, gate = parts[:5]
            if target in TIERS and not tier:
                target, tier = "", target
            if (kind == extra.get("route") == "放弃" and not target and not gate
                    and tier in {"", "易"} and DECLINE.match(title)):
                kind, tier = "静观", ""
            cards.append({"kind": kind, "title": title, "target": target, "tier": tier,
                          "gate": gate, **extra})
        if found:
            continue
        said = SAID.match(plain(line))
        if said and said[1] != "离" and cards and cards[-1] is not None:
            key = "success" if said[1] == "成" else "failure"
            cards[-1].setdefault("said", {}).setdefault(key, said[2])
    return [card for card in cards if card is not None]


# A thread's fields, in order (life/threads.cjs reads them).
THREAD_FIELDS = ("text", "who", "place", "spot", "when", "item")


# A line of <threads> that settles what the beat saw to: 了结|T2, a thread's id, or 了结|Y3, an
# entry of the ledger the beat's prompt lists (a 诺 kept).
SETTLE = "了结"
CLOCK_DONE = "息警"
THREAD_STATE = {"进展": "progress", SETTLE: "completed", "失败": "failed", "放弃": "abandoned"}
SETTLED_ID = re.compile(r"[TY]\d+")


def thread_lines(reply):
    """The fields of each line of the reply's <threads> block: a bracketed line split by a bar,
    or a line without the brackets read the same way."""
    blocks = THREADS.findall(str(reply or ""))
    lines = []
    for line in "\n".join(blocks).splitlines():
        bare = plain(line).strip().lstrip("-*·•").strip()
        for each in CARD.findall(line) or ([bare] if bare else []):
            lines.append([plain(part).strip() for part in FIELDS.split(each)])
    return lines


def threads_of(reply):
    """The story threads the reply's <threads> block leaves: [{ text, who, place, spot, when,
    item }], each a line of up to six fields (empty ones ''); a line whose first field is empty
    is none, and a 了结 line settles one (settled_of). The engine keeps at most two and checks
    the rest."""
    threads = []
    story = plain(story_of(reply))
    for parts in thread_lines(reply):
        if not parts[0] or parts[0] in THREAD_STATE or parts[0] == CLOCK_DONE:
            continue
        promise = parts[6] if len(parts) == 7 else ""
        fields = dict(zip(THREAD_FIELDS, parts + [""] * len(THREAD_FIELDS)))
        if promise and 4 <= len(promise) <= 80 and promise in story:
            fields["promise"] = promise
        threads.append(fields)
    return threads


def settled_of(reply):
    """The ids the reply's <threads> block says the beat saw to (了结|T2, 了结|Y3): threads and
    entries of the ledger."""
    ids = []
    for parts in thread_lines(reply):
        if parts[0] == SETTLE:
            for found in (part for part in parts[1:] if SETTLED_ID.fullmatch(part)):
                if found not in ids:
                    ids.append(found)
    return ids


def known_thread_ids(threads=(), taking=None, continuity=None):
    """The frozen beat's actual thread IDs, shared by prompting and settlement."""
    ids = {row.get("id") for row in (continuity or {}).get("goals") or []
           if isinstance(row, dict)}
    ids.update(line.split(" ", 1)[0] for line in threads or [] if isinstance(line, str))
    if isinstance(taking, dict):
        ids.add(taking.get("id"))
    return {key for key in ids if isinstance(key, str) and re.fullmatch(r"T\d+", key)}


def thread_changes(reply, known):
    """Validate known matters; audit nonexistent references without inventing a new matter.

    An optional progress annotation for an unknown T ID has no state to change. Dropping that
    annotation must not block valid engine receipts or reinterpret a notice/job as a thread.
    Known matters still require verbatim evidence; malformed updates remain protocol errors.
    """
    story = plain(story_of(reply))
    updates, errors, dropped = [], [], []
    for parts in thread_lines(reply):
        if parts[0] not in THREAD_STATE:
            if len(parts) > 6 and not (len(parts) == 7 and 4 <= len(parts[6]) <= 80
                                      and parts[6] in story):
                errors.append("新线头第七段仅用于明确承诺，须摘本拍正文四至八十字的承诺原句")
            continue
        if parts[0] == SETTLE and all(re.fullmatch(r"Y\d+", p) for p in parts[1:]):
            continue  # Karma has its own engine settlement.
        if len(parts) != 3 or not re.fullmatch(r"T\d+", parts[1]):
            errors.append("更新线头须写[进展/了结/失败/放弃|现有T编号|本拍正文原句]，一行只写一条")
            continue
        if parts[1] not in known:
            dropped.append({"id": parts[1], "status": THREAD_STATE[parts[0]],
                            "reason": "本回合不存在这条线头，未写入事项进度"})
            continue
        fact = parts[2]
        if not 4 <= len(fact) <= 80 or fact not in story:
            errors.append("线头的进展或结果须摘本拍正文中四至八十字的一段，说明实际发生的事")
            continue
        updates.append({"id": parts[1], "status": THREAD_STATE[parts[0]], "result": fact})
    return updates, errors, dropped


def clock_completions(reply, tasks):
    """Optional proof of completing a specific clock's named task in this beat."""
    story = plain(story_of(reply))
    allowed = {(row["id"], row["task"]) for row in tasks}
    completed, dropped = [], []
    for parts in thread_lines(reply):
        if parts[0] != CLOCK_DONE:
            continue
        if (len(parts) == 4 and (parts[1], parts[2]) in allowed
                and 4 <= len(parts[3]) <= 80 and parts[3] in story):
            completed.append({"id": parts[1], "task": parts[2]})
        else:
            dropped.append("息警未记入：仅接受本拍已列出的编号、事项全名和正文原句")
    return completed, dropped


def leave_line(reply):
    """A light scene's line for leaving it (离：…) in the reply's <actions>, or ''."""
    found = ACTIONS.search(str(reply or ""))
    for line in (found[1] if found else "").splitlines():
        said = SAID.match(plain(line))
        if said and said[1] == "离":
            return said[2]
    return ""


def parse_actions(reply):
    """The model's cards and whether they are the fallback: ([card], fallback). The <actions>
    block's cards when it has any; else the <branches> sentences, each a card for the engine to
    sort (kind ''), fallback True."""
    found = ACTIONS.search(str(reply or ""))
    cards = cards_in(found[1]) if found else []
    if cards:
        return cards, False
    branches = BRANCHES.search(str(reply or ""))
    sentences = branch_options(branches[0]) if branches else []
    cards = [{"kind": "", "title": plain(OPTION_LETTER.sub("", sentence, count=1)).strip(),
              "target": "", "tier": "", "gate": ""} for sentence in sentences if sentence.strip()]
    return cards, True


def scene_title(reply):
    """The scene's name the model gave (<scene>), or ''."""
    found = SCENE.search(str(reply or ""))
    return plain(found[1]).strip() if found else ""


def close_weight(reply):
    """The weight the model closed the scene with (<close>), or '' when it did not close it."""
    found = CLOSE.search(str(reply or ""))
    return plain(found[1]).strip() if found else ""


def couplet_of(reply):
    """The 回目 the model gave a scene's close (<title>), or '' (the engine checks it)."""
    found = TITLE.search(str(reply or ""))
    return plain(found[1]).strip() if found else ""


def volume_of(reply):
    """The 卷末语 the model wrote for the volume a gate closed (<volume>), or ''."""
    found = VOLUME.search(str(reply or ""))
    return plain(found[1]).strip() if found else ""


def kept_reply(reply, cards):
    """The reply as the save keeps it: without <actions>, <scene>, <close> and <threads>, its
    dates in the calendar's words (play_state.calendar_words: 「二月初十一」 is 二月十一), and
    with the priced cards' titles as its <branches> (none when the beat closed the scene)."""
    text = calendar_words(LIFE_TAGS.sub("", str(reply or "")))
    text = BRANCHES.sub("", text).rstrip()
    titles = [card.get("title", "") for card in cards or [] if card.get("title")]
    if not titles:
        return text
    letters = "ABCDEFGH"
    options = "".join(f"[{letters[i]}.{title}]" for i, title in enumerate(titles[: len(letters)]))
    return f"{text}\n<branches>{options}</branches>"
