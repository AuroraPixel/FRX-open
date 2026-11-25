"""A turn as typed blocks for the new interface (docs/play-contracts.md, 结构化回合).

The model writes a turn the old card's way: the story inside <content>, state commands inside
<upstore>, options inside <branches>; an engine-settled turn puts the engine's receipt cards in
front of the story. The new interface renders blocks instead: the player's action, the engine's
results (check, combat, receipt), scene and entrance changes, the story as narration and speech,
and the options. Nothing the model wrote reaches the page as markup: every tag is dropped, and
the model's emphasis and the names of the people present are kept as marks.

This module only reads; it never changes a save.
"""

import html
import json
import re

from .card_snapshots import KEPT, resolve_snapshot
from .domain import ROOT
from .life import life_of
from .play_art import same_name
from .play_places import same_place
from .play_state import Moment, Save, action_cards, place_reading, scene_view

# What JavaScript's String.prototype.trim and the regex class \s count as white space.
JS_SPACE = "\t\n\v\f\r                  　﻿"
JS_S = "[" + re.escape(JS_SPACE) + "]"


def js_trim(text):
    return text.strip(JS_SPACE)


# ---------------------------------------------------------------- options

# The old page's parseBranchOptions starts an option only at A to D, so a fifth option (the
# worldbook asks for five) was glued to the fourth and sent with it; here E to H start one too.
OPTION_START = re.compile(r"\[" + JS_S + r"*[A-H](?:[.．、:：]|" + JS_S + r"*\])", re.I)
OPTION_LETTER = re.compile(r"^[A-Ha-h]" + JS_S + r"*[.．、:：]" + JS_S + "*")


def branch_options(content):
    """The options of a reply's <branches> block, read as the old page's parseBranchOptions
    reads them (one per lettered bracket [A.…], with what follows the closing bracket kept),
    except that letters past D start an option of their own."""
    body = re.sub(
        r"^" + JS_S + r"*<branches>([\s\S]*)</branches>" + JS_S + r"*$",
        lambda match: match[1],
        str(content or ""),
        count=1,
        flags=re.I,
    )
    starts, depth = [], 0
    for index, char in enumerate(body):
        if char == "[":
            if depth == 0 and OPTION_START.match(body, index):
                starts.append(index)
            depth += 1
        elif char == "]":
            depth = max(0, depth - 1)
    if not starts:
        return [match[1:-1] for match in re.findall(r"\[[^\]]+\]", body)]
    options = []
    for number, start in enumerate(starts):
        end_of = starts[number + 1] if number + 1 < len(starts) else len(body)
        segment = js_trim(body[start:end_of])
        level, end = 0, -1
        for index, char in enumerate(segment):
            if char == "[":
                level += 1
            elif char == "]":
                level -= 1
                if level == 0:
                    end = index
                    break
        if end == -1:
            options.append(js_trim(segment[1:]))
            continue
        parts = [js_trim(segment[1:end]), js_trim(segment[end + 1 :])]
        options.append(" ".join(part for part in parts if part))
    return options


def options_block(branch_content):
    """The options of a reply as an options block, the letters the page shows left out."""
    items = [
        {"index": number, "text": text}
        for number, option in enumerate(branch_options(branch_content), 1)
        if (text := plain(OPTION_LETTER.sub("", option, count=1)))
    ]
    return {"type": "options", "items": items} if items else None


# ---------------------------------------------------------------- people


NAME_NOTE = re.compile(r"[（(][^（）()]*[）)]$")
# What may follow a name of the people table in a speaker's name and still mean him: 孙力师兄.
TITLES = {"师兄", "师姐", "师弟", "师妹", "师叔", "师伯", "师父", "师傅", "师尊", "前辈", "道友",
          "道长", "仙师", "仙长", "大哥", "大叔", "大娘", "大婶", "大爷", "老爷", "公子", "姑娘",
          "小姐", "掌柜", "老丈", "老伯", "兄", "弟", "姐", "妹", "叔", "伯", "爷"}


def row_name(row):
    return plain(str((row or {}).get("1", ""))).split("|")[0].strip()


def row_role(row):
    """「身份 · 境界」 from a person's 境界|身份 column."""
    realm, _, identity = plain(str((row or {}).get("2", ""))).partition("|")
    parts = [part.strip() for part in (identity, realm) if part.strip() and part.strip() != "待定"]
    return " · ".join(parts) or None


class Cast:
    """The people a turn's text can name: the player and everyone in the people table. A
    finished turn's cast also has the people of the table before it (`before`), so someone
    who speaks and then leaves in the same turn is still named by id; the table after the turn
    wins where both have a person."""

    def __init__(self, tables, before=None):
        people = (tables or {}).get("0") or {}
        earlier = (before or {}).get("0") or {}
        self.player = row_name(people.get("B1")) or row_name(earlier.get("B1")) or None
        # Someone who left keeps his id, unless the model gave the id to someone else.
        left = {key: row for key, row in earlier.items() if isinstance(row, dict) and (
            key not in people or row_name(people[key]) == row_name(row))}
        self.rows = {key: row for key, row in {**left, **people}.items()
                     if isinstance(row, dict)}
        self.by_name = {}
        for key in [*people, *left]:
            name = row_name(self.rows.get(key))
            if name and key != "B1":
                self.by_name.setdefault(name, key)
        # A table name with a note (余子童（残魂）) is also known without it.
        for name, key in list(self.by_name.items()):
            self.by_name.setdefault(NAME_NOTE.sub("", name).strip() or name, key)

    def is_player(self, name):
        base = NAME_NOTE.sub("", name).strip() or name
        return base in {"你", "我"} or bool(self.player and base == self.player)

    def key_of(self, name):
        """The id of the person a speaker's name means: the name of the table, or a form of it
        that fits only one person — the table's name after a description (赵三 for 贼哨赵三,
        悍匪 for 阔口悍匪) or before a title (孙力师兄 for 孙力). None when nobody or more than
        one person fits."""
        base = NAME_NOTE.sub("", name).strip() or name
        key = self.by_name.get(name) or self.by_name.get(base)
        if key is not None or len(base) < 2:
            return key
        found = {key for known, key in self.by_name.items()
                 if known != base and known.endswith(base)}
        found |= {key for known, key in self.by_name.items()
                  if len(known) >= 2 and base.startswith(known) and base[len(known):] in TITLES}
        return found.pop() if len(found) == 1 else None

    def knows(self, name):
        return self.is_player(name) or self.key_of(name) is not None

    def speaker(self, name):
        # A note after the name (余子童（残魂）, 你（低声）) does not hide who speaks.
        if self.is_player(name):
            return {"name": name, "charId": "B1", "self": True}
        key = self.key_of(name)
        if key is None:
            return {"name": name}
        speaker = {"name": name, "charId": key}
        if role := row_role(self.rows[key]):
            speaker["role"] = role
        return speaker

    def names(self):
        """Names worth marking in the story, longest first so a longer name wins."""
        return sorted(
            ((name, key) for name, key in self.by_name.items() if len(name) >= 2),
            key=lambda pair: -len(pair[0]),
        )


# ---------------------------------------------------------------- story text

HIDDEN = re.compile(
    r"<(thinking|think|tablethink|upstore|branches|news_ref|tag_think)\b[^>]*>[\s\S]*?</\1\s*>",
    re.I,
)
EMPHASIS_TAGS = {"strong", "b", "em", "i"}
BREAK_TAGS = {"br"}
BLOCK_TAGS = {"p", "div", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
              "ul", "ol", "li", "table", "tr", "details", "summary", "hr"}
DROPPED_TAGS = {"script", "style", "img", "audio", "video", "iframe", "image"}
TAG = re.compile(r"<(/?)([A-Za-z][\w-]*)\b[^>]*?(/?)>", re.S)
IMAGE_PROMPT = re.compile(r"image###[\s\S]*?###")
# A spoken paragraph: a name, a colon, then only quoted lines. The rule asks for “”; a model may
# still use the 「」 of Chinese print, and those count too (『』, often a thought, does not). A
# name is never a sentence: no quote marks, white space or sentence punctuation in it.
SPOKEN_LINE = r"“[^”]*”|「[^」]*」"
DIALOGUE = re.compile(
    r"^([^：:“”「」『』\s，,。！？!?；;、]{1,12})[：:]\s*((?:(?:" + SPOKEN_LINE + r")\s*)+)$"
)
QUOTE = re.compile(SPOKEN_LINE)


def plain(text):
    """Text without any markup and with entities read."""
    return html.unescape(TAG.sub("", str(text or "")))


def markdown_emphasis(text):
    """The page's convertSimpleMarkdown for emphasis: **x**, __x__, *x*, _x_ become tags. A **
    left without its pair (「开**要」) is dropped: it is no emphasis and no word."""
    text = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\b__(.*?)__\b", r"<strong>\1</strong>", text)
    text = re.sub(r"\*([^*]+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"\*{2,}", "", text)
    return re.sub(r"\b_([^_]+?)_\b", r"<em>\1</em>", text)


def without_cards(story):
    """The story without the engine's receipt cards (balanced <div class="frx-…"> blocks)."""
    out, index = [], 0
    for match in re.finditer(r'<div\b[^>]*class="frx-[^"]*"[^>]*>', story):
        if match.start() < index:
            continue
        depth, end = 0, None
        for tag in re.finditer(r"<div\b|</div\s*>", story[match.start():]):
            depth += 1 if tag[0].startswith("<div") else -1
            if depth == 0:
                end = match.start() + tag.end()
                break
        if end is None:
            break
        out.append(story[index:match.start()])
        index = end
    out.append(story[index:])
    return "".join(out)


def story_of(reply_or_content):
    """The story part of a reply or of a saved log's content: inside <content> when it has one,
    without hidden blocks, engine cards and image prompts."""
    text = HIDDEN.sub("", str(reply_or_content or ""))
    match = re.search(r"<content>([\s\S]*?)(?:</content>|$)", text, re.I)
    if match:
        text = match[1]
    else:
        text = re.split(r"<(?:upstore|branches)\b", text, maxsplit=1, flags=re.I)[0]
    return IMAGE_PROMPT.sub("", without_cards(text))


def utf16(text, index):
    """A Python index as the browser's string index (UTF-16 code units)."""
    return len(text[:index].encode("utf-16-le")) // 2


class Paragraph:
    """One paragraph being read from markup: its text and the spans the model emphasised."""

    def __init__(self):
        self.text = ""
        self.open = []
        self.spans = []

    def add(self, text):
        self.text += text

    def start(self):
        self.open.append(len(self.text))

    def end(self):
        if self.open:
            start = self.open.pop()
            if len(self.text) > start:
                self.spans.append((start, len(self.text)))


def paragraphs(story):
    """The story's paragraphs as (text, emphasised spans), split at blank lines and at the block
    elements the model may have written."""
    text = markdown_emphasis(story)
    found, current = [], Paragraph()

    def finish():
        nonlocal current
        raw = current.text
        lead = len(raw) - len(raw.lstrip(JS_SPACE))
        body = js_trim(raw)
        if body:
            spans = [(max(0, s - lead), min(len(body), e - lead)) for s, e in current.spans]
            found.append((body, [(s, e) for s, e in spans if e > s]))
        current = Paragraph()

    def add_text(chunk):
        chunk = html.unescape(chunk).replace("\r\n", "\n")
        pieces = re.split(r"\n" + JS_S + r"*\n", chunk)
        for number, piece in enumerate(pieces):
            if number:
                finish()
            current.add(piece)

    position, dropped = 0, None
    for match in TAG.finditer(text):
        if dropped is None:
            add_text(text[position:match.start()])
        position = match.end()
        closing, name = match[1], match[2].lower()
        if dropped:
            if closing and name == dropped:
                dropped = None
            continue
        if name in DROPPED_TAGS:
            if not closing and not match[3] and name not in {"img", "image"}:
                dropped = name
            continue
        if name in EMPHASIS_TAGS:
            current.end() if closing else current.start()
        elif name in BREAK_TAGS:
            current.add("\n")
        elif name in BLOCK_TAGS:
            finish()
    if dropped is None:
        add_text(text[position:])
    finish()
    return found


def spoken_form(text):
    """A paragraph as the dialogue rule reads it: trimmed, and out of the 「」 a model copies
    from the rule's own wording (「名字：“话”」) when the whole paragraph sits in one pair."""
    text = text.strip()
    if text.startswith("「") and text.endswith("」") and text.count("「") == 1:
        text = text[1:-1].strip()
    return text


def story_blocks(story, cast):
    """Narration and speech blocks of a story (markup or plain text with markdown)."""
    blocks = []
    for text, spans in paragraphs(story):
        blocks += paragraph_blocks(text, spans, cast)
    return blocks


def speech(name, quoted, cast):
    return {"type": "speech", "speaker": cast.speaker(name), "lines": QUOTE.findall(quoted)}


def paragraph_blocks(text, spans, cast):
    """One paragraph's blocks. A paragraph in the rule's form (名字：“话”) is speech. Otherwise it
    is narration, out of which comes the speech the model wrote inside it wherever the speaker is
    certain: a line in the rule's form, a quote after a colon whose sentence has one subject the
    cast knows (inline_speaker), and the rule's form copied inside 「」 (「钱平：“……”」)."""
    spoken = DIALOGUE.match(spoken_form(text))
    if spoken and not acted(spoken[1], cast):
        return [speech(spoken[1], spoken[2], cast)]
    cuts = []
    lines = [(found.start(), found.end()) for found in re.finditer(r"[^\n]+", text)]
    for start, end in lines:
        line = DIALOGUE.match(spoken_form(text[start:end]))
        if len(lines) > 1 and line and not acted(line[1], cast):
            cuts.append((start, end, speech(line[1], line[2], cast)))
        else:
            cuts += inline_speech(text, start, end, cast)
    if not cuts:
        return [narration(text, spans, cast)]
    blocks, position = [], 0
    for start, end, block in cuts:
        blocks += narration_between(text, spans, position, start, cast)
        blocks.append(block)
        position = end
    return blocks + narration_between(text, spans, position, len(text), cast)


def narration_between(text, spans, start, end, cast):
    """The narration of text[start:end] as a block of its own (none when it is empty), with
    the emphasis spans that fall in it; a comma left after the speech before it goes too."""
    piece = text[start:end]
    lead = len(piece) - len(piece.lstrip(JS_SPACE + "，,、"))
    body = js_trim(piece[lead:])
    if not body:
        return []
    first = start + lead
    inside = [(max(s, first) - first, min(e, first + len(body)) - first) for s, e in spans]
    return [narration(body, [(s, e) for s, e in inside if e > s], cast)]


# ---------------------------------------------------------------- speech inside narration

# A paragraph of narration often carries what someone says after a colon, as novels write it:
# 「你压低嗓音道：“……”」, 「钱羽……啐道：“……”」. The model does this most for the player's own
# words. Such a quote becomes a speech block only when its speaker is certain: the sentence up to
# the colon has one subject, the player or someone the people table knows, at the head of its
# clauses, and nothing else heads a clause of it (no other name, no pronoun, no 那人, 老者, 掌柜 or
# the like, nothing that reads as another subject). Pronouns are never followed back to a name.
# What someone only thinks or reads stays narration, as does every quote the rule cannot place.

LEAD_COLON = re.compile("[：:]" + JS_S + "*$")
SENTENCE_BREAK = re.compile(r"[。！？!?；;\n“”「」『』]|…+|—{2,}")
CLAUSE_BREAK = re.compile(r"[，,：:]")
NOT_SAID = re.compile(
    r"心道|暗道|心想|暗想|暗忖|忖道|心中|心里|心头|心底|念头|默念|寻思|思忖|想道|想着|心说|腹诽|"
    r"写着|写道|刻着|书着|上书|题着|印着|标着|名为|名曰|称为|号称|唤作|叫做|所谓|字样|写下|"
    r"留言|批注|记载|载有|传言|传闻|俗话说|有言"
)
HEAD_PREFIX = re.compile(
    r"^(?:紧接着|说话间|与此同时|只见|随即|当即|于是|此时|这时|此刻|那时|见状|闻言|说着|接着|"
    r"随后|继而|旋即|末了|最后|当下|立时|顿时|忽然|突然|然而|不料|谁知|可是|但是|不过|而|却|"
    r"便|也|又|但|可)+"
)
TOGETHER = re.compile(r"^(?:们|我|和|与|跟|同|及|俩|二人|两人)")
OTHER_HEAD = re.compile(
    r"^(?:他|她|它|我|"
    r"(?:那|这|此|一|两|二|三|几|数|某|众|诸|各|另|其中)(?:人|位|名|个|些|群|伙|帮|汉|老|少|妇|"
    r"女|男|修|弟|贼|道|僧)|"
    r"旁人|有人|来人|对方|"
    r"老者|少年|青年|汉子|大汉|掌柜|伙计|小二|店家|师兄|师姐|师弟|师妹|师父|师傅|师叔|师伯|"
    r"长老|掌门|弟子|修士|散修|道人|道士|老道|和尚|僧人|妇人|女子|男子|姑娘|少女|老妪|老妇|"
    r"大娘|大婶|大爷|老汉|老头|老翁|黑影|人影|身影|管事|护卫|守卫|卫兵|官差|捕快|山贼|贼人|"
    r"匪徒|喽啰|猎户|樵夫|药农|农夫|车夫|挑夫|脚夫|商贩|行商|货郎|书生|公子|小姐|丫鬟|侍女|"
    r"童子|孩童|小童|婆婆|婆子|门房|寨主|头领|首领|东家)"
)
# Two to four characters and then a word that follows a subject (岑闻渡却……, 那汉子闻言……):
# someone the people table does not know.
UNKNOWN_HEAD = re.compile(
    r"^[\u4e00-\u9fff]{2,4}?(?:却|也|便|又|已|竟|亦|则|才|仍|还|就|都|正|闻言|见状|抢先|抢着|"
    r"接口|连忙|赶忙|急忙)"
)
# A speaker's "name" that is a pronoun, or a name with what he does: 他冷笑, 铁臂虎吃痛暴吼
# (老道 and 贫道 are names).
ACTED = re.compile(
    r"^(?:他|她|它|那人|此人|对方)|.{2,}(?:(?<![老贫])道|说|问|喝|笑|叹|喊|答|斥|吼|嚷|叫|骂|哼|"
    r"应|呼|啐|嘀咕|嘟囔|喃喃|念叨|开口)[了着]?$"
)


def acted(name, cast):
    """A speaker's name in the rule's form that is no name: a pronoun, or a name with an action
    (铁臂虎吃痛暴吼). A name the cast knows is a name, whatever its last character."""
    base = NAME_NOTE.sub("", name).strip() or name
    return bool(ACTED.search(base)) and not cast.knows(name)


def clause_head(clause, cast):
    """Who heads a clause: ("player", name), ("person", name), ("other",) or None."""
    text = HEAD_PREFIX.sub("", js_trim(clause), count=1)
    players = sorted({"你", cast.player or "你"}, key=len, reverse=True)
    for kind, names in (("player", players), ("person", [name for name, _ in cast.names()])):
        for name in names:
            if text.startswith(name):
                return ("other",) if TOGETHER.match(text[len(name):]) else (kind, name)
    if OTHER_HEAD.match(text) or UNKNOWN_HEAD.match(text):
        return ("other",)
    return None


def inline_speaker(lead, cast):
    """The speaker of a quote written after `lead` inside narration, when certain (see above):
    the name heading the sentence before the colon, else None."""
    if not LEAD_COLON.search(lead):
        return None
    sentence = LEAD_COLON.sub("", SENTENCE_BREAK.split(lead)[-1])
    clauses = CLAUSE_BREAK.split(sentence)
    if NOT_SAID.search(clauses[-1]):
        return None
    heads = [head for head in (clause_head(clause, cast) for clause in clauses) if head]
    if not heads or heads[0] == ("other",) or any(head != heads[0] for head in heads[1:]):
        return None
    return heads[0][1]


def inline_speech(text, start, end, cast):
    """The speech inside text[start:end] that inline_speaker places, or that names its speaker
    in the rule's form inside 「」: [(start, end, speech block)], the quotes that follow one
    another with only space between them in one block."""
    cuts, position = [], start
    quotes = list(QUOTE.finditer(text, start, end))
    index = 0
    while index < len(quotes):
        found = quotes[index]
        inner = DIALOGUE.match(found[0][1:-1].strip()) if found[0].startswith("「") else None
        if inner and not acted(inner[1], cast):
            cuts.append((found.start(), found.end(), speech(inner[1], inner[2], cast)))
            position, index = found.end(), index + 1
            continue
        name = inline_speaker(text[position:found.start()], cast)
        if name is None:
            index += 1
            continue
        last = index
        while last + 1 < len(quotes) and not js_trim(
            text[quotes[last].end():quotes[last + 1].start()]
        ):
            last += 1
        quoted = text[found.start():quotes[last].end()]
        cuts.append((found.start(), quotes[last].end(), speech(name, quoted, cast)))
        position, index = quotes[last].end(), last + 1
    return cuts


def narration(text, spans, cast):
    marks = [(s, e, "em", None) for s, e in spans]
    for name, key in cast.names():
        for found in re.finditer(re.escape(name), text):
            if not any(found.start() < e and s < found.end() for s, e, _, _ in marks):
                marks.append((found.start(), found.end(), "name", key))
    block = {"type": "narration", "text": text}
    if marks:
        block["marks"] = [
            {"start": utf16(text, s), "end": utf16(text, e), "kind": kind,
             **({"charId": key} if key else {})}
            for s, e, kind, key in sorted(marks)
        ]
    return block


class StoryStream:
    """Story text as it streams, cut into paragraphs as the blocks will be: tell(delta) returns
    what to send for it: ("open", block), ("text", id, delta) and ("close", id, replace, block),
    where `replace` is the finished block when it differs from what was sent and `block` the
    finished block either way. A paragraph that ends as several blocks (narration with speech
    cut out of it) closes as its first block; each further block opens empty and closes with
    itself as the replacement, under an id of its own."""

    def __init__(self, cast, number):
        self.cast = cast
        self.number = number
        self.raw = ""
        self.block_id = None
        self.sent = ""

    def tell(self, delta):
        events = []
        self.raw += delta
        while True:
            cut = re.search(r"\n" + JS_S + r"*\n", self.raw)
            if not cut:
                break
            done, self.raw = self.raw[: cut.start()], self.raw[cut.end():]
            events += self.flush(done, final=True)
        events += self.flush(self.raw, final=False)
        return events

    def finish(self):
        events = self.flush(self.raw, final=True)
        self.raw = ""
        return events

    def flush(self, raw, *, final):
        events = []
        visible = self.visible(raw, final)
        if visible and self.block_id is None:
            self.block_id = self.number()
            self.sent = ""
            events.append(("open", {"id": self.block_id, "type": "narration", "text": ""}))
        if self.block_id and visible.startswith(self.sent) and len(visible) > len(self.sent):
            events.append(("text", self.block_id, visible[len(self.sent):]))
            self.sent = visible
        if final and self.block_id:
            blocks = story_blocks(raw, self.cast)
            sent = {"id": self.block_id, "type": "narration", "text": self.sent}
            block = {"id": self.block_id, **blocks[0]} if blocks else sent
            events.append(("close", self.block_id, block if block != sent else None, block))
            for more in blocks[1:]:
                more = {"id": self.number(), **more}
                events.append(("open", {"id": more["id"], "type": "narration", "text": ""}))
                events.append(("close", more["id"], more, more))
            self.block_id = None
        return events

    @staticmethod
    def visible(raw, final):
        """The paragraph's text so far without markup, holding back a tag, an entity or an
        emphasis that is not finished yet."""
        if not final:
            for mark, close in (("<", ">"), ("&", ";")):
                at = raw.rfind(mark)
                if at >= 0 and close not in raw[at:]:
                    raw = raw[:at]
            while "*" in raw and (raw.count("*") % 2 or raw.count("**") % 2):
                raw = raw[: raw.rfind("**") if raw.count("**") % 2 else raw.rfind("*")]
        found = paragraphs(raw)
        return found[0][0] if found else ""


# ---------------------------------------------------------------- engine receipts

OUTCOMES = {"大成功": "critical_success", "大失败": "critical_failure", "成功": "success"}
RECEIPT_KINDS = {
    "use_item": ("loss", "用物"),
    "claim_item": ("gain", "领取"),
    "use_skill": ("skill", "施展"),
    "equip_item": ("gain", "装备"),
    "unequip_item": ("loss", "装备"),
    "update_quest": ("quest", "任务"),
    "rest": ("rest", "休整"),
    "trade_item": ("trade", "交易"),
    "cultivate": ("cultivate", "修炼"),
    "breakthrough": ("breakthrough", "突破"),
    "chapter_reward": ("quest", "主线奖励"),
    "world_rule": ("cultivate", "天道"),
    "purse": ("stones", "钱袋"),
    "resolve_attack": ("injury", "交锋"),
    "resolve_check": ("quest", "检定"),
    # the cultivation life's own (apps/engine/life/): a standing verb's receipts, a card taken
    # (act: a check block when it rolled), the cards and a beat (hidden: no block), a scene's
    # opening (a mark) and its close card (with the closing mark), the month's calendar rows and
    # the director's additions (their annals lines and the panels say them: no block)
    "wait": ("rest", "静候"),
    "act": ("gain", "行动"),
    "cards": ("quest", "行动卡"),
    "scene": ("quest", "开场"),
    "close": ("close", "收场"),
    "calendar": ("quest", "日历"),
    "director": ("quest", "推演"),
    # the gates and 悟得 (items 22 and 23): an attempt at a gate (the breakthrough verb's receipt
    # carries the gate it was), 压境 at a full gate, the 悟得 taken, and 守拙 turning a clock back
    "gate": ("gate", "冲关"),
    "polish": ("cultivate", "打磨"),
    "perk": ("gain", "悟得"),
    "calm": ("quest", "守拙"),
    # a fight (item 20): its opening (no block: the story says it) and each move, drawn as the
    # exchanges and the checks it holds, with the end when it ended
    "fight": ("injury", "斗法"),
    # someone met in the wild (item 31): it carries frxPlay, the beat's cards say the rest
    "encounter": ("quest", "遭遇"),
    # a journey (items 27, 28: the verb travel, and the model's move_place with its annals lines),
    # a stretch gathering, a day hunting, and what a felled foe leaves (item 30)
    "travel": ("quest", "赶路"),
    "scene_arrival": ("quest", "抵达"),
    "gather": ("gain", "采集"),
    "hunt": ("quest", "狩猎"),
    "loot": ("gain", "战利品"),
    # what a 奇遇's scene gave as it closed, by how its cards went (item 50's fixes)
    "fortune": ("gain", "奇遇"),
    # a gate's 机缘 a scene of the story gave (the engine's chance op, item 50's fixes)
    "chance": ("gain", "机缘"),
    # a secret realm's steps (item 32: enter, node, check, loot, close, leave, shut), and the
    # people's month and the player's ties (item 37), which carry frxPlay and show no block
    "realm": ("quest", "秘境"),
    "people": ("quest", "人物"),
    "tie": ("quest", "羁绊"),
    # asking around, a notice taken or a job paid or dropped, and a deal (item 35)
    "ask": ("quest", "打探"),
    "visit": ("quest", "拜访"),
    # a story thread taken up (接着办), and the threads a beat left (batch 9: hidden, the state
    # view's threads show them)
    "follow": ("quest", "接着办"),
    "thread": ("quest", "线头"),
    "job": ("quest", "差事"),
    "trade": ("trade", "买卖"),
    # a pending event that went off (its annals line and the scene it opens say it: no block)
    "pending": ("quest", "由头"),
    # gear (items 33, 34): 祭炼, 修补, the belt set (no block), a piece given by someone; and a
    # craft (item 42): batches made, work hired out, or fetched
    "refine": ("cultivate", "祭炼"),
    "repair": ("gain", "修补"),
    "belt": ("quest", "腰带"),
    "gift": ("gain", "赠物"),
    # a 储物袋 someone handed over in the story, opened by the engine (the owner's fourth playtest);
    # the things the story's own commands registered are the 获得 block (delta_receipts)
    "bag": ("gain", "储物袋"),
    "craft": ("gain", "炼制"),
    # a spirit beast (item 41): fed, bound, hatched, bought, given, taken up a tier, the month's
    # newborn (going out with the player or back, and a month with none born, show no block)
    "beast": ("gain", "灵兽"),
    # a lead proven (item 26), the ledger and the heart knots (item 40)
    "lead": ("quest", "疑点"),
    "karma": ("quest", "因果"),
    "knot": ("quest", "心结"),
    # an array laid or a teleport array's errand taken (item 43); the home's doings and its rent
    # (item 45)
    "array": ("quest", "布阵"),
    "home": ("gain", "洞府"),
    # the sect (item 46): joining, an exchange, a promotion, a duty done and a contest; the
    # stipend and a contest signed up for carry frxPlay and show no block (hidden)
    "sect": ("quest", "宗门"),
    # the lifespan's end (item 49): 大限将至 coming on (taken off again: hidden), the death of old
    # age, and the heir going on (a panel action's, which shows no block)
    "legacy": ("legacy", "坐化"),
}
# Kinds of the cultivation life whose receipt says what moved the clock (receipt.time).
TIMED_KINDS = {"wait", "travel", "gather", "hunt", "ask", "refine", "repair", "craft",
               "beast", "visit", "array", "home", "follow"}
# The cultivation life's receipts that never show as a block of their own.
SILENT_KINDS = {"cards", "calendar", "director", "encounter", "people", "tie", "pending", "belt"}
# Receipts whose blocks come after the story: a scene's close card and its closing mark, and the
# page of the volume a gate's big scene closed (item 38).
# A 奇遇's goods (kind fortune) are settled after its close card (rewards.cjs), so they come
# after the story too (plan item 50's fixes: they landed before it).
AFTER_STORY_KINDS = {"close", "volume", "fortune"}


def told_after(receipt):
    """Whether a receipt's blocks come after the story: a scene's close, and what the engine
    settled after the story (`afterStory`: the opening's first method put on, item 25)."""
    return receipt.get("kind") in AFTER_STORY_KINDS or bool(receipt.get("afterStory"))


def signed(value):
    return f"{'+' if value >= 0 else ''}{value}"


def check_block(check):
    note = check.get("consequence") or ""
    effects = [
        f"{e['stat']} {e['before']}→{e['after']}/{e['max']}"
        for e in check.get("effects", [])
        if not e.get("endsCombat")
    ]
    if effects:
        note = "；".join([note, *effects]) if note else "；".join(effects)
    title = f"{check.get('kind', '')}检定" + (
        f" · {check['target']['name']}" if check.get("target") else "")
    block = {
        "type": "check", "title": title, "roll": int(check.get("roll", 0)),
        "modifiers": [{"label": f"{check.get('attribute', '')}修正",
                       "value": int(check.get("modifier", 0))}],
        "total": int(check.get("total", 0)), "difficulty": int(check.get("dc", 0)),
        "outcome": OUTCOMES.get(check.get("outcome"), "failure"),
    }
    if note:
        block["note"] = note
    return block


def combat_blocks(attack, moves=None):
    """The strikes of an exchange, one block each. `moves`: what each fighter's strike is called
    (a fight's commands and the foes' intents); else the attacker's move and the counters."""
    names = {attack["attacker"]["id"]: attack["attacker"]["name"],
             attack["target"]["id"]: attack["target"]["name"],
             **(attack.get("names") or {})}
    move = (attack.get("skill") or {}).get("name") or "普通攻击"
    blocks = []
    for strike in attack.get("strikes", []):
        modifiers = [{"label": "身法", "value": int(strike.get("agility", 0))},
                     {"label": "境界", "value": int(strike.get("realm", 0))}]
        if strike.get("ambush"):
            modifiers.append({"label": "偷袭", "value": int(strike["ambush"])})
        block = {
            "type": "combat",
            "attacker": {"name": names.get(strike["by"], strike["by"]), "charId": strike["by"]},
            "defender": {"name": names.get(strike["at"], strike["at"]), "charId": strike["at"]},
            "move": (moves or {}).get(strike["by"])
            or (move if strike["by"] == attack["attacker"]["id"] else "反击"),
            "roll": int(strike.get("roll", 0)), "modifiers": modifiers,
            "total": int(strike.get("total", 0)), "defense": int(strike.get("dc", 0)),
            "hit": bool(strike.get("hit")),
        }
        if strike.get("hit"):
            block["damage"] = int(strike.get("damage", 0))
            hp = strike.get("hp") or {}
            if "after" in hp and "max" in hp:
                block["defenderHp"] = {"current": int(hp["after"]), "max": int(hp["max"])}
        if strike.get("defeated"):
            block["end"] = "lose" if strike["at"] == "B1" else "win"
        blocks.append(block)
    return blocks


def receipt_lines(receipt):
    """The lines of a receipt card: what changed, else the engine's own summary."""
    lines = []
    cultivation = receipt.get("cultivation") or {}
    if cultivation and receipt.get("ok"):
        before, after = cultivation.get("before", {}), cultivation.get("after", {})
        if before.get("realm") != after.get("realm"):
            lines.append({"label": "境界", "value": str(after.get("realm")),
                          "delta": f"{before.get('realm')}→{after.get('realm')}"})
        gain = cultivation.get("gain")
        lines.append({"label": "修为", "value": str(after.get("progress")),
                      **({"delta": signed(gain)} if isinstance(gain, int) else {})})
    breakthrough = receipt.get("breakthrough") or {}
    if breakthrough and receipt.get("ok"):
        realm = breakthrough.get("realm") or {}
        lines.append({"label": "境界", "value": str(realm.get("after", "")),
                      "delta": f"{realm.get('before', '')}→{realm.get('after', '')}"})
    # what 调息 brought back, and what a 静候 while injured did (养伤: the wait's healed)
    rest = [*((receipt.get("rest") or {}).get("changes") or []), *(receipt.get("healed") or [])]
    for change in rest if receipt.get("ok") else []:
        lines.append({"label": change["stat"], "value": f"{change['after']} / {change['max']}",
                      "delta": signed(change["after"] - change["before"])})
    purse = receipt.get("purse") or {}
    if purse and receipt.get("ok"):
        lines.append({"label": "灵石", "value": str(purse.get("after"))})
    if receipt.get("kind") in TIMED_KINDS and receipt.get("ok"):
        lines += time_lines(receipt)
    return lines or [{"label": for_player(plain(receipt.get("summary", "")))}]


def day_words(moment):
    """「正月初十」 for a time row's 「0001年 01月 10日 07:20」 (play_state.Moment's date)."""
    return Moment(str(moment or "")).date or str(moment or "")


def time_lines(receipt):
    """What a verb of the cultivation life moved: the day it ended on, and the age when a year
    turned on the way."""
    lines = []
    time = receipt.get("time") or {}
    if time.get("after"):
        lines.append({"label": "日期", "value": day_words(time["after"])})
    age = receipt.get("age") or {}
    if isinstance(age.get("before"), int) and isinstance(age.get("after"), int) and (
            age["after"] != age["before"]):
        lines.append({"label": "年龄", "value": str(age["after"]),
                      "delta": signed(age["after"] - age["before"])})
    return lines


# The rows' ids an engine summary names for the model: 「放入储物袋 I2」, 「（I10）」.
ROW_IDS = (re.compile(r"(储物袋)\s*[A-Z]\d+"), re.compile(r"\s*[（(][A-Z]\d+[）)]"))


def for_player(summary):
    """An engine summary as the page shows it: without the table rows' ids, which the model reads
    in it and the player has never seen (item 73's walkthrough, turn 3: 「放入储物袋 I2」)."""
    text = ROW_IDS[0].sub(r"\1", summary)
    return ROW_IDS[1].sub("", text)


def receipt_blocks(receipt):
    """The blocks of one engine receipt: a check, the strikes of an exchange, or a receipt; for
    the cultivation life also a card taken, a scene's opening mark and its close."""
    kind = receipt.get("kind")
    if receipt.get("readOnly"):
        return []
    if receipt.get("hidden") or kind in SILENT_KINDS:
        return []
    if kind == "act":
        return act_blocks(receipt)
    if kind == "scene":
        scene = receipt.get("scene") or {}
        opening = receipt.get("action") == "open"
        return [mark_block("open", scene.get("title", ""), scene.get("chapter"))] if opening else []
    if kind == "close":
        return close_blocks(receipt)
    if kind == "thread" and receipt.get("bounty") and not receipt.get("bountyInClose"):
        return [{"type": "receipt", "kind": "stones", "title": "赏金",
                 "lines": [*purse_line(receipt["bounty"]), *receipt_lines(receipt)]}]
    if kind == "gate" or (kind == "breakthrough" and isinstance(receipt.get("gate"), dict)):
        return gate_blocks(receipt)
    if kind == "fight":
        return fight_blocks(receipt)
    if kind == "realm":
        return realm_blocks(receipt)
    if kind == "volume" and receipt.get("ok"):
        return [volume_block(receipt)]
    if kind == "emerge" and receipt.get("ok"):
        return [emerge_block(receipt)]
    if kind in LIFE_LINES and receipt.get("ok"):
        title, lines = LIFE_LINES[kind](receipt)
        # the model's move_place brings the journey's annals lines with it (item 28); asking
        # around and a haggle show their die first (item 35)
        annals = [chronicle_block(entry) for entry in chronicle_entries(receipt.get("chronicle"))]
        return [*annals, *rolled_blocks(receipt),
                {"type": "receipt", "kind": RECEIPT_KINDS[kind][0], "title": title,
                 "lines": lines or receipt_lines(receipt)}]
    if kind == "resolve_check" and receipt.get("ok") and receipt.get("check"):
        return [check_block(receipt["check"])]
    if kind == "resolve_attack" and receipt.get("ok") and receipt.get("attack"):
        return combat_blocks(receipt["attack"])
    shape, label = RECEIPT_KINDS.get(kind, ("gain", "结算"))
    if kind == "cultivate" and receipt.get("mode") == "机缘":
        label = "机缘"
    block = {"type": "receipt", "kind": shape,
             "title": label if receipt.get("ok") else f"{label}未成",
             "lines": receipt_lines(receipt)}
    if kind == "cultivate" and receipt.get("ok"):
        minutes = (receipt.get("cultivation") or {}).get("requestedMinutes") or 60
        block["fx"] = {"name": "cultivate", "seconds": max(1.0, min(6.0, minutes / 60))}
    if kind == "breakthrough" and receipt.get("ok") and receipt.get("breakthrough"):
        check = receipt["breakthrough"]
        realm = check.get("realm") or {}
        # the realm aimed at: reached on a success, and what 「冲关 · 筑基」 names on a failure
        block["fx"] = {"name": "breakthrough",
                       "success": realm.get("before") != realm.get("after"),
                       "realm": str(check.get("to") or realm.get("after", ""))}
    return [block]


# ---------------------------------------------------------------- the life's cards and scenes


def mark_block(kind, title, chapter=None, couplet=None):
    """Where a scene opens or closes, with its name; in the life its 回 and, closing, its 回目."""
    return {"type": "mark", "kind": kind, "title": str(title or ""),
            **({"chapter": chapter} if isinstance(chapter, int) and chapter > 0 else {}),
            **({"couplet": str(couplet)} if couplet else {})}


def book_line(line):
    return {**({"date": line["date"]} if isinstance(line.get("date"), dict) else {}),
            "text": str(line.get("text") or "")}


def volume_block(receipt):
    """A volume's closing page (item 38): the engine's annals of it and the model's words."""
    volume = receipt.get("volume") or {}
    cause = volume.get("cause") or {}
    return {"type": "volume", "no": int(volume.get("no") or 1),
            **({"cause": cause["kind"]} if cause.get("kind") in ("gate", "event") else {}),
            **({"name": str(cause["name"])} if cause.get("name") else {}),
            **({"since": volume["from"]} if isinstance(volume.get("from"), dict) else {}),
            **({"until": volume["to"]} if isinstance(volume.get("to"), dict) else {}),
            "annals": [book_line(line) for line in volume.get("annals") or []
                       if isinstance(line, dict)],
            **({"text": str(volume["text"])} if volume.get("text") else {}),
            "next": int(volume.get("next") or int(volume.get("no") or 1) + 1)}


def emerge_block(receipt):
    """出关见闻 (item 38): what the world did while a stretch of years went by."""
    emerge = receipt.get("emerge") or {}
    return {"type": "emerge", "years": max(1, int(emerge.get("years") or 1)),
            **({"since": emerge["from"]} if isinstance(emerge.get("from"), dict) else {}),
            **({"until": emerge["to"]} if isinstance(emerge.get("to"), dict) else {}),
            "lines": [book_line(line) for line in emerge.get("lines") or []
                      if isinstance(line, dict)]}


def act_blocks(receipt):
    """A card the player took (the engine's act receipt): its check when it rolled; when it went
    without a roll, a receipt of what it changed (none when it changed nothing: 静观, 离开), a
    买卖 card's deal first (the thing bought or sold, as the engine settled it)."""
    if not receipt.get("ok"):
        return []
    if receipt.get("check"):
        return [check_block(receipt["check"])]
    lines = [{"label": paid["stat"], "value": str(paid["after"]),
              "delta": signed(paid["after"] - paid["before"])}
             for paid in receipt.get("paid") or [] if paid.get("after") != paid.get("before")]
    lines += [{"label": effect["stat"], "value": str(effect["after"]),
               "delta": signed(effect["after"] - effect["before"])}
              for effect in receipt.get("effects") or []
              if effect.get("after") != effect.get("before")]
    # a deal the engine settled (a 买卖 card): the thing bought or sold first, as a deal's receipt
    deal = receipt.get("trade") or {}
    if deal.get("settled") and deal.get("name"):
        lines.insert(0, {"label": str(deal["name"]), "value": "1",
                         "delta": "买入" if deal.get("direction") == "buy" else "卖出"})
    if not lines:
        return []
    card = receipt.get("card") or {}
    return [{"type": "receipt", "kind": "trade" if card.get("kind") == "买卖" else "gain",
             "title": str(card.get("title") or "行动"), "lines": lines}]


def close_lines(receipt):
    """A close card's lines: the weight, then each thing that changed and where it went."""
    lines = [{"label": "分量", "value": str(receipt.get("weight") or "")}]
    for line in receipt.get("lines") or []:
        change = line.get("change")
        delta = signed(change) if isinstance(change, int) else None
        if line.get("kind") == "favour":
            lines.append({"label": str(line.get("to") or line.get("label") or ""),
                          "value": str(line.get("after")), **({"delta": delta} if delta else {})})
        elif line.get("kind") == "clock":
            lines.append({"label": str(line.get("to") or "压力钟"),
                          **({"delta": f"{delta}格"} if delta else {})})
        elif line.get("kind") == "item":
            lines.append({"label": str(line.get("label") or ""), "value": str(line.get("to") or ""),
                          **({"delta": delta} if delta else {})})
        else:
            lines.append({"label": str(line.get("label") or ""),
                          **({"value": str(line["after"])} if "after" in line else {}),
                          **({"delta": delta} if delta else {})})
    return lines


def close_blocks(receipt):
    """A scene's close: its close card (the weight and what changed) and the closing mark."""
    title = str((receipt.get("scene") or {}).get("title") or "")
    card = {"type": "receipt", "kind": "close", "title": f"收场 · {title}" if title else "收场",
            "lines": close_lines(receipt)}
    return [card, mark_block("close", title, receipt.get("chapter"), receipt.get("couplet"))]


def scene_title(receipts):
    """The scene's latest name among a turn's receipts (the model names it on the first beat,
    after the opening mark first went out under the place's name), or None."""
    for receipt in reversed(receipts or []):
        if receipt.get("kind") in {"scene", "close"} and (receipt.get("scene") or {}).get("title"):
            return receipt["scene"]["title"]
    return None


def gate_blocks(receipt):
    """An attempt at a gate in the cultivation life: 「冲关 · 筑基」, the realm reached and the
    foundation it leaves (or 未成 and the cooldown), the years it adds and the pills it took,
    with the stage's breakthrough show."""
    check = receipt.get("breakthrough") or {}
    gate = receipt.get("gate") or {}
    realm = check.get("realm") or {}
    success = bool(receipt.get("ok")) and bool(realm) and realm.get("before") != realm.get("after")
    reached = str(check.get("to") or realm.get("after") or "")
    lines = []
    if success:
        lines.append({"label": "境界", "value": reached})
        if foundation := gate.get("foundation") or check.get("foundation"):
            lines.append({"label": "根基", "value": str(foundation)})
    else:
        stayed = realm.get("before") or check.get("from") or ""
        lines.append({"label": "境界", "value": str(stayed)})
        if check.get("cooldownUntil"):
            lines.append({"label": "再冲", "value": str(check["cooldownUntil"])})
    lifespan = check.get("lifespan") or {}
    if isinstance(lifespan.get("after"), int) and lifespan.get("after") != lifespan.get("before"):
        age = (receipt.get("age") or {}).get("after")
        lines.append({"label": "寿元", "value": f"{age} / {lifespan['after']}" if isinstance(
            age, int) else str(lifespan["after"]),
            **({"delta": signed(lifespan["after"] - lifespan["before"])}
               if isinstance(lifespan.get("before"), int) else {})})
    for aid in check.get("aids") or []:
        if isinstance(aid, dict) and aid.get("name"):
            lines.append({"label": str(aid["name"]), "delta": signed(-int(aid.get("count") or 1))})
    name = str(gate.get("name") or reached)
    # the heart knots' 心魔 at 结丹 and 元婴 (item 40): a 神识 check each, before the gate's card
    demons = [check_block(demon["check"]) for demon in receipt.get("demons") or []
              if isinstance(demon, dict) and isinstance(demon.get("check"), dict)]
    return [*demons, {"type": "receipt", "kind": "gate",
             "title": f"冲关 · {name}" if success else f"冲关 · {name}未成",
             "lines": lines,
             "fx": {"name": "breakthrough", "success": success, "realm": reached}}]


def polish_lines(receipt):
    polish = receipt.get("polish") or {}
    lines = []
    if isinstance(polish.get("after"), int):
        lines.append({"label": "压境", "value": f"{polish['after']}日",
                      **({"delta": signed(polish["days"])} if isinstance(polish.get("days"), int)
                         else {})})
    points = polish.get("points") or {}
    if isinstance(points.get("after"), int):
        moved = points["after"] - points["before"] if isinstance(points.get("before"), int) else 0
        lines.append({"label": "根基", "value": f"{points['after']}分",
                      **({"delta": signed(moved)} if moved else {})})
    return "打磨", lines + time_lines(receipt)


def perk_lines(receipt):
    perk = receipt.get("perk") or {}
    name = perk.get("name") if isinstance(perk, dict) else str(perk or "")
    lines = [{"label": str(name or ""), "value": str(perk.get("text") or "")}] if isinstance(
        perk, dict) else []
    lifespan = receipt.get("lifespan") or {}
    if isinstance(lifespan.get("after"), int):
        lines.append({"label": "寿元", "value": str(lifespan["after"]),
                      **({"delta": signed(lifespan["after"] - lifespan["before"])}
                         if isinstance(lifespan.get("before"), int) else {})})
    return f"悟得 · {name}" if name else "悟得", lines


def calm_lines(receipt):
    change = receipt.get("clock") or {}
    lines = []
    if change.get("name") and isinstance(change.get("after"), int):
        lines.append({"label": str(change["name"]), "value": f"{change['after']}格",
                      **({"delta": signed(change["after"] - change["before"])}
                         if isinstance(change.get("before"), int) else {})})
    return f"守拙 · {receipt.get('perk') or '悟得'}", lines


def goods_lines(items):
    """Goods as receipt lines: each name with its count and unit (「止血草」「3株」)."""
    return [{"label": str(item.get("name") or ""),
             "value": f"{item.get('count', '')}{item.get('unit') or ''}"}
            for item in items or [] if isinstance(item, dict) and item.get("name")]


def travel_lines(receipt):
    trip = receipt.get("travel") or {}
    to = trip.get("to")
    to = to.get("name") if isinstance(to, dict) else to
    lines = []
    if to:
        lines.append({"label": "去处", "value": str(to) if trip.get("arrived", True)
                      else f"{to}（半路停下）"})
    return "赶路", lines + time_lines(receipt)


def gather_lines(receipt):
    gathered = receipt.get("gather") or {}
    return "采集", goods_lines(gathered.get("items")) + time_lines(receipt)


def hunt_lines(receipt):
    target = (receipt.get("hunt") or {}).get("target") or {}
    lines = ([{"label": str(target["name"]), "value": str(target.get("realm") or "")}]
             if target.get("name") else [{"label": "没寻着猎物"}])
    return "狩猎", lines + time_lines(receipt)


def loot_lines(receipt):
    loot = receipt.get("loot") or {}
    foe = (loot.get("foe") or {}).get("name")
    return (f"战利品 · {foe}" if foe else "战利品"), goods_lines(loot.get("items"))


def bag_lines(receipt):
    """A 储物袋 someone handed over, opened by the engine: what was in it, or that it was empty."""
    owner = str((receipt.get("bag") or {}).get("name") or "")
    lines = goods_lines(receipt.get("items")) or [{"label": "袋里", "value": "空无一物"}]
    return (f"储物袋 · {owner}" if owner else "储物袋"), lines


def fortune_lines(receipt):
    """A 奇遇's scene closed (item 50's fixes): what it gave (a gate's 机缘 among it, for an 元婴
    whose 化神 asks for one), or that the chance came to nothing."""
    fortune = receipt.get("fortune") or {}
    items = goods_lines(fortune.get("items"))
    chance = fortune.get("chance") if isinstance(fortune.get("chance"), dict) else None
    if chance:
        items.append({"label": "机缘", "value": f"冲击{chance.get('name') or chance.get('gate')}"})
    title = str((fortune.get("scene") or {}).get("title") or "")
    if not items:
        return "奇遇落空", [{"label": title or "奇遇", "value": "一无所得"}]
    return (f"奇遇 · {title}" if title else "奇遇"), items


def chance_lines(receipt):
    """A gate's 机缘 a scene of the story gave (the chance op, item 50's fixes): the gate it is for
    and what it is."""
    chance = receipt.get("chance") or {}
    return "机缘", [{"label": f"冲击{chance.get('name') or chance.get('gate') or ''}",
                     "value": str(chance.get("reason") or "")}]


def ask_lines(receipt):
    """Asking around (item 35): each clue heard, then the day it ended on."""
    clues = [{"label": "线索", "value": str(clue.get("text") or "")}
             for clue in receipt.get("clues") or [] if isinstance(clue, dict)]
    return "打探", clues + time_lines(receipt)


def job_lines(receipt):
    """A notice taken, or a job paid or lapsed (item 35)."""
    job, pay = receipt.get("job") or {}, receipt.get("pay") or {}
    lines = [{"label": "差事", "value": str(job.get("title") or "")}]
    if isinstance(pay.get("after"), int):
        lines.append({"label": "灵石", "value": str(pay["after"]), "delta": signed(pay["amount"])})
    # a job done gives the goods of the cell 差事 besides its pay (item 50's fixes)
    lines += goods_lines(receipt.get("items"))
    titles = {"take": "接差事", "done": "差事办成", "lapse": "差事作罢"}
    return titles.get(receipt.get("action"), "差事"), lines


def trade_lines(receipt):
    """A deal (item 35): the good and how many, and the purse after it."""
    trade = receipt.get("trade") or {}
    good, stones = trade.get("good") or {}, trade.get("stones") or {}
    lines = [{"label": str(good.get("name") or ""), "value": str(trade.get("count") or ""),
              "delta": "买入" if trade.get("side") == "buy" else "卖出"}]
    if isinstance(stones.get("after"), int) and isinstance(stones.get("before"), int):
        lines.append({"label": "灵石", "value": str(stones["after"]),
                      "delta": signed(stones["after"] - stones["before"])})
    return "买卖", lines


def rolled_blocks(receipt):
    """The die a verb of the life rolled before its receipt (item 35): asking around's 探查 or
    交涉, and a haggle's 交涉, drawn as a check like a card's."""
    if receipt.get("kind") == "ask" and isinstance(receipt.get("check"), dict):
        check = receipt["check"]
        return [check_block({**check, "kind": check.get("rule") or check.get("kind")})]
    haggle = (receipt.get("trade") or {}).get("haggle")
    if receipt.get("kind") == "trade" and isinstance(haggle, dict):
        note = f"讨成了，让{haggle.get('off')}%" if haggle.get("off") else "没讨下来"
        return [check_block({"kind": haggle.get("check"), "attribute": haggle.get("attribute"),
                             "roll": haggle.get("roll"), "modifier": haggle.get("modifier"),
                             "total": haggle.get("total"), "dc": haggle.get("dc"),
                             "outcome": haggle.get("outcome"), "consequence": note})]
    return []


def refine_lines(receipt):
    """祭炼 (item 33): the piece and how far its attunement has come, then the day it ended on."""
    refine = receipt.get("refine") or {}
    done, need = refine.get("done"), refine.get("need")
    value = "圆满" if refine.get("full") else (
        f"{done}/{need}日" if isinstance(done, (int, float)) and isinstance(need, (int, float))
        else "")
    return "祭炼", [{"label": str(refine.get("name") or ""), "value": value}] + time_lines(receipt)


def repair_lines(receipt):
    """修补 (item 34): by the player's own hand (the material, how far, mended), or handed to a
    smith (the stones, the day to fetch it)."""
    repair = receipt.get("repair") or {}
    name = str(repair.get("name") or "")
    if repair.get("smith"):
        lines = [{"label": name, "value": f"{repair.get('until') or ''}取回"}]
        if isinstance(repair.get("stones"), int):
            lines.append({"label": "灵石", "value": str(repair["stones"]), "delta": "付给炼器师"})
        return "修补", lines
    done, need = repair.get("done"), repair.get("need")
    value = "修好了" if repair.get("mended") else (
        f"{done}/{need}日" if isinstance(done, (int, float)) and isinstance(need, (int, float))
        else "")
    lines = [{"label": name, "value": value}]
    if repair.get("material"):
        lines.append({"label": "用料", "value": str(repair["material"])})
    return "修补", lines + time_lines(receipt)


def gift_lines(receipt):
    """A piece given by someone the player is close to (item 34)."""
    gift = receipt.get("gift") or {}
    lines = [{"label": str(gift.get("item") or ""), "value": str(gift.get("condition") or "")}]
    return f"赠物 · {gift.get('name') or ''}".rstrip(" ·"), lines


def craft_lines(receipt):
    """A craft (item 42): the recipe, what each batch came out as, the goods and the mastery when
    it rose, then the day it ended on; work hired out (the fee, the day to fetch it), or fetched."""
    craft = receipt.get("craft") or {}
    recipe = craft.get("recipe")
    lines = [{"label": "方子", "value": str(recipe)}] if recipe else []
    results = [str(each) for each in craft.get("results") or [] if each]
    if results:
        lines.append({"label": "成色", "value": "、".join(
            f"{quality}{results.count(quality)}" for quality in dict.fromkeys(results))})
    lines += goods_lines(craft.get("items"))
    mastery = craft.get("mastery") or {}
    if mastery.get("after") and mastery.get("after") != mastery.get("before"):
        lines.append({"label": "手艺", "value": str(mastery["after"]),
                      "delta": f"{mastery.get('before') or ''}→{mastery['after']}"})
    hired = craft.get("hired") or {}
    if hired:
        lines.append({"label": "取货", "value": str(hired.get("due") or "")})
        if isinstance(hired.get("fee"), int):
            lines.append({"label": "灵石", "value": str(hired["fee"]), "delta": "工钱"})
        return f"请人{craft.get('craft') or '炼制'}", lines
    if craft.get("fetched"):
        return "取货", lines or [{"label": for_player(plain(receipt.get("summary", "")))}]
    return str(craft.get("craft") or "炼制"), lines + time_lines(receipt)


# The life's receipts with lines of their own: (title, lines) from the receipt.
def lead_lines(receipt):
    """A lead proven (item 26): its line, where it was looked into, and the reveal it brings."""
    lead = receipt.get("lead") or {}
    lines = [{"label": "查实", "value": str(lead.get("line") or "")}]
    if receipt.get("reveal"):
        lines.append({"label": "揭晓", "value": "这一章的疑点都查实了"})
    return "疑点", lines


def karma_lines(receipt):
    """Entries of the ledger made or settled (item 40): each its seal (恩 怨 债 诺), who and what;
    the heart knots a broken promise left."""
    action = receipt.get("action")
    entries = receipt.get("entries") or ([receipt["entry"]] if receipt.get("entry") else [])
    lines = [{"label": str(entry.get("kind") or ""),
              "value": f"{(entry.get('who') or {}).get('name') or ''}：{entry.get('what') or ''}"}
             for entry in entries if isinstance(entry, dict)]
    lines += [{"label": "心结", "value": str(knot.get("what") or "")}
              for knot in receipt.get("knots") or [] if isinstance(knot, dict)]
    return ("因果 · 了结" if action == "done" else "因果"), lines


def knot_lines(receipt):
    """A heart knot noted or resolved (item 40): its kind, the person and the deed."""
    knot = receipt.get("knot") or {}
    lines = [{"label": str(knot.get("kind") or ""),
              "value": f"{(knot.get('who') or {}).get('name') or ''}：{knot.get('what') or ''}"}]
    for gain in receipt.get("mind") or []:
        if isinstance(gain, dict) and isinstance(gain.get("after"), int):
            lines.append({"label": "心境", "value": str(gain["after"]),
                          "delta": signed(int(gain.get("change") or 0))})
    return ("心结 · 了结" if receipt.get("action") == "resolve" else "心结"), lines


def beast_lines(receipt):
    """A spirit beast (item 41): fed (the food, the aptitude before and after, a bloodline that
    changed, the feeds left this month), bound (how far, or bound), an egg set to hatch, bought,
    given, taken up a tier, and the month's newborn."""
    beast = receipt.get("beast") or {}
    action, name = beast.get("action"), str(beast.get("name") or "")
    said = for_player(plain(receipt.get("summary", "")))
    if action == "feed":
        lines = [{"label": str(beast.get("item") or ""),
                  "value": f"资质 {beast.get('before')}→{beast.get('after')}"}]
        if (beast.get("evolved") or {}).get("to"):
            lines.append({"label": "血脉", "value": str(beast["evolved"]["to"])})
        if isinstance(beast.get("left"), int):
            lines.append({"label": "本月还能喂", "value": f"{max(0, beast['left'] - 1)}次"})
        return f"喂养 · {name}", lines
    if action == "bind":
        done, need = beast.get("done"), beast.get("need")
        value = "认了主" if beast.get("bound") else f"{done}/{need}日"
        return f"认主 · {name}", [{"label": name, "value": value}] + time_lines(receipt)
    if action == "promote":
        return f"进阶 · {name}", [{"label": name,
                                    "value": f"{beast.get('before')}→{beast.get('after')}"},
                                   {"label": "服下", "value": str(beast.get("item") or "")}]
    titles = {"hatch": "孵蛋", "buy": f"买下 · {name}", "gift": f"受赠 · {name}",
              "month": "破壳"}
    return titles.get(action, "灵兽"), [{"label": said}] if said else []


# The life's receipts with lines of their own: (title, lines) from the receipt.
def purse_line(purse):
    """The purse after a payment, with what it took: 灵石 270 −30."""
    if not isinstance(purse, dict) or not isinstance(purse.get("after"), int) or not isinstance(
            purse.get("before"), int):
        return []
    return [{"label": "灵石", "value": str(purse["after"]),
             "delta": signed(purse["after"] - purse["before"])}]


def array_lines(receipt):
    """An array laid (item 43): its tier and name (阵力减半 when the check failed), the check, the
    stones put in it, then the day; or a teleport array's repair errand taken."""
    if receipt.get("action") == "repair":
        job = receipt.get("job") or {}
        return "接差事", [{"label": "差事", "value": str(job.get("title") or "")}]
    array = receipt.get("array") or {}
    named = f"{array.get('tier') or ''}{array.get('label') or array.get('name') or ''}"
    if array.get("laid") is False:
        return "布阵未成", [{"label": named, "value": "布到一半被打断"}] + time_lines(receipt)
    lines = [{"label": "阵", "value": named,
              **({"delta": "阵力减半"} if isinstance(array.get("power"), (int, float))
                 and array["power"] < 1 else {})}]
    check = array.get("check") or {}
    if check.get("outcome"):
        lines.append({"label": "神识检定", "value": str(check["outcome"])})
    return "布阵", lines + purse_line(array.get("purse")) + time_lines(receipt)


HOME_TITLES = {"buy": "买下洞府", "rent": "租下洞府", "take": "抢洞府", "build": "洞府修房",
               "plant": "药园种药", "harvest": "药园收药", "leave": "弃了洞府",
               "lost": "洞府被收回"}


def home_lines(receipt):
    """The home (item 45): bought or rented (the purse), claimed or not, taken in a fight, a room
    built, herbs planted and harvested, given up; the month's rent paid, or the home lost."""
    home, action = receipt.get("home") or {}, receipt.get("action")
    title = HOME_TITLES.get(action, "洞府")
    if action == "rent" and receipt.get("source") == "engine":
        return "交租", [{"label": "租金", "value": str(home.get("yearly"))},
                        *purse_line(home.get("purse"))]
    if action == "claim":
        title = "占下洞府" if home.get("claimed") else "没寻着地方"
        check = receipt.get("check") or {}
        lines = [{"label": "洞府", "value": str(home.get("place") or "")}]
        if check.get("outcome"):
            lines.append({"label": "检定", "value": str(check["outcome"])})
        return title, lines + time_lines(receipt)
    if action == "build":
        return title, [{"label": "房", "value": str(home.get("room") or "")},
                       *purse_line(home.get("purse"))] + time_lines(receipt)
    if action == "plant":
        return title, [{"label": str(home.get("herb") or ""), "value": str(home.get("count") or ""),
                        "delta": "种下"}, {"label": "熟期", "value": day_words(home.get("due"))}]
    if action == "harvest":
        return title, goods_lines(home.get("items"))
    if action == "take":
        foe = (home.get("from") or {}).get("name") or ""
        return title, [{"label": "洞府", "value": str(home.get("place") or "")},
                       {"label": "对手", "value": str(foe)}]
    return title, [{"label": "洞府", "value": str(home.get("place") or "")},
                   *purse_line(home.get("purse"))]


# A contest's places (content/life/sects.json contests places) in words.
PLACE_WORDS = {1: "一", 2: "二", 4: "四", 8: "八", 16: "十六"}


def sect_lines(receipt):
    """The sect (item 46): joining (the status and the weapon issued), an exchange (what and the
    contribution left), a promotion, a duty (its contribution and the day it ended), a contest
    (the place, each bout, the contribution and the prizes)."""
    sect = receipt.get("sect") or {}
    action = sect.get("action")
    if action == "join":
        lines = [{"label": "身份", "value": str(sect.get("status") or "")}]
        if sect.get("issued"):
            lines.append({"label": "领到", "value": str(sect["issued"])})
        return f"入{sect.get('name') or '宗门'}", lines
    if action == "exchange":
        paid = sect.get("contribution") or {}
        return f"兑换 · {sect.get('hall') or '宗门'}", [
            {"label": str(sect.get("name") or "")},
            {"label": "贡献", "value": str(paid.get("after", "")),
             "delta": signed(-int(sect.get("price") or 0))}]
    if action == "promote":
        return "晋升", [{"label": "身份", "value": str(sect.get("after") or ""),
                         "delta": f"{sect.get('before', '')}→{sect.get('after', '')}"}]
    if action == "duty":
        lines = [{"label": "差事", "value": str(sect.get("title") or "")}]
        if sect.get("contribution"):
            lines.append({"label": "贡献", "delta": signed(int(sect["contribution"]))})
        return "宗门差事", lines + time_lines(receipt)
    if action == "contest":
        bouts = sect.get("bouts") or []
        place = sect.get("place")
        lines = [{"label": "名次", "value": f"第{PLACE_WORDS.get(place, str(place))}名"}] \
            if isinstance(place, int) else [{"label": "误了日子"}]
        for bout in bouts:
            foe = bout.get("foe") or {}
            lines.append({"label": f"{foe.get('name', '')}（{foe.get('realm', '')}）",
                          "value": "胜" if bout.get("won") else "负"})
        if sect.get("contribution"):
            lines.append({"label": "贡献", "delta": signed(int(sect["contribution"]))})
        return f"宗门{sect.get('contest') or '比试'}", lines + goods_lines(sect.get("items"))
    return "宗门", []


def legacy_lines(receipt):
    """The lifespan's end (item 49): 大限将至 (the years left and the day the lifespan runs out),
    the death of old age (the age, the realm, the place; in extreme mode the save starts over
    after the turn), and the heir going on (who, what was left, the last word)."""
    legacy = receipt.get("legacy") or {}
    action = legacy.get("action")
    if action == "twilight":
        return "大限将至", [
            {"label": "寿元", "value": str(legacy.get("lifespan", ""))},
            {"label": "年龄", "value": str(legacy.get("age", ""))},
            {"label": "还剩", "value": f"{legacy.get('left', '')}年"},
            {"label": "寿元用尽", "value": date_words(legacy.get("ends"))}]
    if action == "died":
        lines = [{"label": "享年", "value": str(legacy.get("age", ""))}]
        if legacy.get("realm"):
            lines.append({"label": "境界", "value": str(legacy["realm"])})
        if legacy.get("place"):
            lines.append({"label": "坐化于", "value": str(legacy["place"])})
        if legacy.get("extreme"):
            lines.append({"label": "极限模式", "value": "一切归零，从头再来"})
        else:
            heirs = legacy.get("heirs") or []
            lines.append({"label": "传人", "value": "、".join(
                f"{heir.get('kind', '')}{heir.get('name', '')}" for heir in heirs) or "另立后人"})
        return f"{legacy.get('name') or ''}坐化", lines
    if action == "inherit":
        heir = legacy.get("heir") or {}
        left = legacy.get("left") or {}
        lines = [{"label": "传人", "value": f"{heir.get('kind', '')}{heir.get('name', '')}"}]
        if left.get("home"):
            lines.append({"label": "洞府", "value": str(left["home"])})
        lines.append({"label": "仓库", "value": f"{len(left.get('vault') or [])}件"})
        lines.append({"label": "灵石", "value": str(left.get("stones", 0))})
        lines.append({"label": "遗言", "value": str(legacy.get("words") or "")})
        for name in legacy.get("clocks") or []:
            lines.append({"label": str(name), "value": "了结"})
        return "传承", lines
    return "坐化", []


def date_words(key):
    """A frxPlay date ("0011-01-01") as the time row writes it (0011年 01月 01日)."""
    parts = str(key or "").split("-")
    return f"{parts[0]}年 {parts[1]}月 {parts[2]}日" if len(parts) == 3 else str(key or "")


LIFE_LINES = {"polish": polish_lines, "perk": perk_lines, "calm": calm_lines,
              "travel": travel_lines, "gather": gather_lines, "hunt": hunt_lines,
              "loot": loot_lines, "fortune": fortune_lines, "chance": chance_lines,
              "ask": ask_lines,
              "job": job_lines, "trade": trade_lines,
              "refine": refine_lines, "repair": repair_lines, "gift": gift_lines,
              "bag": bag_lines,
              "craft": craft_lines, "lead": lead_lines, "karma": karma_lines,
              "knot": knot_lines, "beast": beast_lines, "array": array_lines,
              "home": home_lines, "sect": sect_lines, "legacy": legacy_lines}


def realm_blocks(receipt):
    """A secret realm's step (item 32): a 险's or a guarded 宝's check as a check block, what a
    宝 or the 守 gave (or that someone was there first), and going in, a node, the closing day,
    going out (with what the herbs sold for) as a receipt with its day."""
    if not receipt.get("ok"):
        return []
    action = receipt.get("action")
    blocks = [check_block(receipt["check"])] if receipt.get("check") else []
    if action == "check":
        return blocks
    realm, node = receipt.get("realm") or {}, receipt.get("node") or {}
    said = for_player(plain(receipt.get("summary", ""))).split("；")[0]
    if action == "loot":
        lines = goods_lines(receipt.get("items")) or [{"label": said}]
        return blocks + [{"type": "receipt", "kind": "gain",
                          "title": f"秘境 · {node.get('kind') or '宝'}", "lines": lines}]
    name = str(realm.get("name") or "秘境")
    title = {"enter": f"入{name}", "leave": f"出{name}", "shut": f"{name}关闭",
             "close": "秘境关闭", "node": f"秘境 · {node.get('kind') or '路'}"}.get(action, name)
    lines = [{"label": said}] if said else []
    if isinstance(receipt.get("stones"), int):
        lines.append({"label": "灵石", "delta": signed(receipt["stones"])})
    return blocks + [{"type": "receipt", "kind": "quest", "title": title,
                      "lines": lines + time_lines(receipt) or [{"label": name}]}]


FIGHT_ENDS = {"win": "胜", "lose": "败", "flee": "脱身", "truce": "罢手"}


def fight_blocks(receipt):
    """A move in a fight (item 20): its check (遁 察 和), its exchanges (the player's strikes
    under the command, a foe's under the intent it acted on), and the end when the fight ended
    on it; a round with neither says what it was. The opening has no block of its own, unless
    the fight was over at it (the foes' ambush downed the player): then its blows and its end,
    as the move that ends a fight shows them."""
    fight = receipt.get("fight") or {}
    if (fight.get("opened") and not fight.get("end")) or not receipt.get("ok"):
        return []
    blocks = [check_block(receipt["check"])] if receipt.get("check") else []
    attack = receipt.get("attack")
    if attack and attack.get("strikes"):
        moves = {foe["id"]: foe["did"] for foe in fight.get("foes") or []
                 if isinstance(foe, dict) and foe.get("did")}
        moves["B1"] = (attack.get("skill") or {}).get("name") or {
            "strike": "攻", "skill": "术", "item": "物"}.get(fight.get("command"), "攻")
        blocks += combat_blocks(attack, moves)
    if fight.get("end"):
        loss = fight.get("loss") or {}
        lines = [{"label": str(loss.get("name") or ""),
                  **({"value": f"灵石{signed(-int(loss['stones']))}"}
                     if isinstance(loss.get("stones"), int) else {})}] if loss.get("name") else []
        said = for_player(plain(receipt.get("summary", "")))
        blocks.append({"type": "receipt", "kind": "injury" if fight["end"] == "lose" else "gain",
                       "title": f"斗法 · {FIGHT_ENDS.get(fight['end'], fight['end'])}",
                       "lines": lines or [{"label": said}]})
    if not blocks:
        blocks.append({"type": "receipt", "kind": "quest", "title": "斗法",
                       "lines": [{"label": for_player(plain(receipt.get("summary", "")))}]})
    return blocks


# The first-time notes of the cultivation life (item 25): one sentence each, with the turn that
# first shows the thing (life_turns.mark_play keeps which were shown in frxPlay.seen).
FIRST_NOTES = {key: text for key, text in json.loads(
    (ROOT / "content/life/prompt.json").read_text(encoding="utf-8"))["firstNotes"].items()
    if key != "note"}


def note_block(key):
    """A first-time note as a notice, named by its key (the page shows close under 接下来)."""
    return {"type": "notice", "level": "info", "text": FIRST_NOTES[key], "note": key}


def perks_block(offer):
    """The 悟得 on offer after a gate (frxPlay.offer), to take one of: the cultivation life's
    PerksBlock, or None when nothing waits to be chosen."""
    items = [{"index": entry["index"], "name": str(entry["name"]),
              "text": str(entry.get("text") or ""),
              **({"rare": True} if entry.get("rare") else {})}
             for entry in offer or [] if isinstance(entry, dict)
             and isinstance(entry.get("index"), int) and entry.get("name")]
    return {"type": "perks", "items": items} if items else None


def perks_on_offer(play):
    """The 悟得 a turn ends with: frxPlay.offer's, only when one can be taken now. While a scene is
    being played the perk verb waits for it to close (verbs.cjs), and in a fight only moves go; a
    gate's turn that opens a scene as well (an event that fell due while the gate took its days)
    shows them on the turn the scene closes on, which every other verb then waits for (先选一条悟得;
    the long scripted playtest, plan item 50)."""
    if not play or play.get("scene") or play.get("fight"):
        return None
    return perks_block(play.get("offer"))


def actions_block(cards):
    items = action_cards(cards)
    if not items:
        return None
    block = {"type": "actions", "items": items}
    if any(isinstance(card, dict) and card.get("fallback") for card in cards):
        block["fallback"] = True
    return block


# ---------------------------------------------------------------- state changes


def tables_of(snapshot):
    """The tables of a log's stateSnapshot (a JSON string) or a state's currentState."""
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except ValueError:
            return {}
    if isinstance(snapshot, dict) and "currentState" in snapshot:
        snapshot = snapshot["currentState"]
    return snapshot if isinstance(snapshot, dict) else {}


def same_person(old, new):
    """Whether a people-table row names the same person after the turn as before: the same name,
    one grown out of or trimmed from the other (青年散修 → 冷眼旁观的青年散修), the same surname
    under another title (孙伯 → 孙掌柜), or a new name over the same background (the model
    telling who 灰袍人 is). Otherwise the model gave the id to someone else (item 53's
    playtest: C1 was 马师叔, then 吴陵)."""
    old_name, new_name = row_name(old), row_name(new)
    if not old_name or not new_name or same_name(old_name, new_name) or old_name[0] == new_name[0]:
        return True

    def background(row):
        return re.sub(r"<[^>]*>|\s", "", str(row.get("10") or ""))[:24]

    return bool(background(old)) and background(old) == background(new)


def entrances(before, after, known, speech, met=()):
    """People present after the turn who were not before: their entrance, the first time when
    the save has never seen them (no biography, not in an earlier state, and by name nowhere in
    the people tables of the turns before: `met`). The model often takes someone out of the table
    and writes him in again under a new id; that is no first meeting, and someone written in again
    while he is still there does not enter at all. It also gives an id someone holds to someone
    new: the newcomer enters, met for the first time unless their name was seen before."""
    was = before.get("0") or {}
    here = {row_name(row) for row in was.values() if isinstance(row, dict)}
    blocks = []
    for key, row in (after.get("0") or {}).items():
        if key == "B1" or not isinstance(row, dict):
            continue
        held = was.get(key)
        reused = isinstance(held, dict) and not same_person(held, row)
        if key in was and not reused:
            continue
        name = row_name(row)
        if name and name in here:
            continue
        block = {"type": "enter", "charId": key, "name": name,
                 "first": (reused or key not in known) and name not in met}
        if role := row_role(row):
            block["role"] = role
        line = next((s["lines"][0] for s in speech if s["speaker"].get("charId") == key), None)
        if line:
            block["line"] = line
        blocks.append(block)
    return blocks


def number_of(value):
    found = re.search(r"-?\d+", str(value or ""))
    return int(found[0]) if found else None


def delta_receipts(before, after, receipts):
    """What the story's own commands changed and no engine receipt already shows: things gained
    and lost from the bag, the purse, and quests taken up or ended."""
    touched = set()
    for receipt in receipts:
        for key in ("item", "claimedItem"):
            touched.add(str((receipt.get(key) or {}).get("id") or ""))
        touched.add(str(receipt.get("claimedId") or ""))
        if receipt.get("kind") in LIFE_LINES:
            # the cultivation life's goods (gather, loot) say what they put in the bag themselves
            touched.update(str(key) for key in (receipt.get("owns") or {}).get("items") or [])
    bag_before, bag_after = before.get("1") or {}, after.get("1") or {}
    blocks = []

    def items(keys, bag):
        return [{"label": row_name(bag[key]), "value": f"×{bag[key].get('5', 1)}"}
                for key in keys if isinstance(bag.get(key), dict) and row_name(bag[key])]

    gained = items([k for k in bag_after if k not in bag_before and k not in touched], bag_after)
    lost = items([k for k in bag_before if k not in bag_after and k not in touched], bag_before)
    if gained:
        blocks.append({"type": "receipt", "kind": "gain", "title": "获得", "lines": gained})
    if lost:
        blocks.append({"type": "receipt", "kind": "loss", "title": "失去", "lines": lost})
    paid = any(r.get("ok") and ((r.get("owns") or {}).get("currency") or r.get("kind") == "purse")
               for r in receipts)
    was = number_of(((before.get("0") or {}).get("B1") or {}).get("26"))
    now = number_of(((after.get("0") or {}).get("B1") or {}).get("26"))
    if not paid and was is not None and now is not None and was != now:
        blocks.append({"type": "receipt", "kind": "stones", "title": "灵石",
                       "lines": [{"label": "灵石", "value": str(now), "delta": signed(now - was)}]})
    quests_before, quests_after = before.get("6") or {}, after.get("6") or {}
    # a notice's quest row, taken, done or dropped, is its job receipt's (item 35)
    jobs = {str(quest) for r in receipts if r.get("kind") == "job" and r.get("ok")
            for quest in (r.get("owns") or {}).get("quests") or []}
    lines = []
    for key, row in quests_after.items():
        if not isinstance(row, dict) or key in jobs:
            continue
        title, status = plain(str(row.get("1", ""))), plain(str(row.get("5", "")))
        old = quests_before.get(key)
        if not isinstance(old, dict):
            lines.append({"label": title, "value": "新任务"})
        elif plain(str(old.get("5", ""))) != status and "完成" in status:
            lines.append({"label": title, "value": "已完成"})
    if lines and not any(r.get("kind") == "update_quest" and r.get("ok") for r in receipts):
        blocks.append({"type": "receipt", "kind": "quest", "title": "任务", "lines": lines})
    return blocks


def scene_block(before, after, looks=None):
    """The scene when the place, the hour, the weather or the drawn scene moved in the turn.
    `before` and `after` are play_state.Save readings of the save around the turn; `looks` the
    looks its places keep (play_state.scene_view)."""
    views = [(save.location, save.location.moment.clock(), scene_view(save, looks))
             for save in (before, after)]
    (old, old_clock, old_view), (new, clock, view) = views
    # a composed place is the same place by its kit and id (its description depends on the map
    # the save carries)
    def place_of(scene):
        return (scene.composed.kit, scene.composed.id) if scene.composed else None

    shown_as = new.text
    if (old.text != new.text and old_view.scene_id == view.scene_id
            and place_of(old_view) == place_of(view)
            and same_place(place_reading(before).key, place_reading(after).key)):
        # the story calls the place it stays at by another name (后院柴房, then 柴房): no journey
        shown_as = old.text
    if (old.text, old_clock.hour, old_view.weather, old_view.scene_id, place_of(old_view)) == (
        shown_as, clock.hour, view.weather, view.scene_id, place_of(view)
    ):
        return None
    block = {"type": "scene", "sceneId": view.scene_id, "place": shown_as, "hour": clock.hour,
             "hourName": clock.hour_name, "date": clock.date, "weather": view.weather,
             "indoor": view.indoor}
    if view.composed:
        block["composed"] = view.composed.wire()
    if view.look:
        block["look"] = view.look.wire()
    return block


# ---------------------------------------------------------------- a whole turn


def clock_mark(clock):
    """The pressure clock that moved on an annals line ({ name, size, value }), or None."""
    if not isinstance(clock, dict):
        return None
    size, value = clock.get("size"), clock.get("value")
    if not clock.get("name") or not isinstance(size, int) or not isinstance(value, int):
        return None
    return {"name": str(clock["name"]), "size": size, "value": value}


def chronicle_entries(lines):
    """The engine's annals lines ({ kind, date: { text, … }, text, line, clock? }) as a verb's
    reply log keeps them (frxChronicle): the day as written, the line's words and the clock that
    moved on it."""
    entries = []
    for line in lines or []:
        if not isinstance(line, dict):
            continue
        entry = {"date": str((line.get("date") or {}).get("text") or ""),
                 "text": str(line.get("text") or "")}
        if clock := clock_mark(line.get("clock")):
            entry["clock"] = clock
        entries.append(entry)
    return entries


def chronicle_block(entry, now=False):
    """A line of the annals (年谱) as a block; `now` marks the save's latest, `clock` the clock
    that moved on it."""
    block = {"type": "chronicle", "date": str(entry.get("date") or ""),
             "text": str(entry.get("text") or "")}
    if now:
        block["now"] = True
    if clock := clock_mark(entry.get("clock")):
        block["clock"] = clock
    return block


def action_block(text, queue=None):
    block = {"type": "action", "text": text}
    if queue:
        block["queue"] = queue
    return block


def played_action(played, offered=()):
    """The action of a turn the new interface sent, as it streamed and as the player saw it: the
    words typed or the option picked (without its letter), and the chips sent with it. Read from
    the player's log instead, the chips would be the old page's command lines (「玩家 前往
    潮岚道/云汀湾|(白苇集) |3354,2040，相距1959公里」, 「使用 金创药散 ×1（I10）」)."""
    option = played.get("option")
    if isinstance(option, int) and 1 <= option <= len(offered):
        text = plain(OPTION_LETTER.sub("", offered[option - 1], count=1))
    else:
        text = str(played.get("input") or "").strip()
    return action_block(text, played.get("queue") or None)


def numbered(blocks):
    """Blocks with their ids in turn order: b1, b2, …"""
    return [{"id": f"b{number}", **{k: v for k, v in block.items() if k != "id"}}
            for number, block in enumerate(blocks, 1)]


def with_kept_ids(blocks, kept):
    """A turn's blocks under the ids its done event gave them, kept with its request as
    [[id, type], …] (CardStore.keep_block_ids): the stream numbers blocks as they go out, so a
    finished turn's are not b1, b2, … in order. Without them (the old page's turns, or turns
    from before the ids were kept), or when they no longer fit the blocks, the ids stay
    numbered in order."""
    if not isinstance(kept, list) or len(kept) != len(blocks):
        return blocks
    pairs = [pair for pair in kept if isinstance(pair, list) and len(pair) == 2
             and isinstance(pair[0], str) and pair[0]]
    ids = [pair[0] for pair in pairs]
    if len(pairs) != len(blocks) or len(set(ids)) != len(ids) or (
        [pair[1] for pair in pairs] != [block["type"] for block in blocks]
    ):
        return blocks
    return [{**block, "id": id_} for block, id_ in zip(blocks, ids, strict=True)]


def user_action_text(content, offered=()):
    """What the player did, from a saved player log: the words after "> " and the visible
    queue lines (the page's "[执行指令]" lines). A line that is one of the options `offered` by
    the reply before (the old page and the new server both send 「A.…」) loses its letter, as
    the stroke of a picked option shows while the turn is played."""
    options = {plain(option).strip() for option in offered}
    lines = [line for line in str(content or "").split("\n") if line.strip()]
    said = [line[2:] if line.startswith("> ") else line for line in lines if line != "[执行指令]"]
    said = [OPTION_LETTER.sub("", plain(line).strip(), count=1) if plain(line).strip() in options
            else line for line in said]
    return plain("\n".join(said)).strip()


def known_people(state):
    """Everyone a save has met: the people table, the bonded characters and the biographies."""
    known = set((state.get("currentState") or {}).get("0") or {})
    known |= set(state.get("bondedCharacters") or {})
    known |= {str(entry.get("key")) for entry in state.get("worldBookEntries") or []
              if isinstance(entry, dict) and entry.get("key")}
    return known


def people_names(table):
    """The names in a tables' people table, the player's own row left out."""
    return {row_name(row) for key, row in (table.get("0") or {}).items()
            if key != "B1" and isinstance(row, dict)}


# The names a round's tables hold (its stateSnapshot), by the string's length and hash: every turn
# of a long save read every round's tables again for them (batch 8). A round's tables never change
# once it is kept, and a string that does is another key.
ROUND_NAMES = {}
ROUND_NAMES_MOST = 50_000


def round_names(snapshot):
    if isinstance(snapshot, dict) and snapshot.get("codec") == KEPT:
        # an older round of a long life save keeps its tables beside it: its stub holds the names
        # met first in it (card_snapshots.kept_tables), and the earlier rounds the rest
        return frozenset(snapshot.get("met") or ())
    if not isinstance(snapshot, str):
        return people_names(tables_of(snapshot))
    key = (len(snapshot), hash(snapshot))
    found = ROUND_NAMES.get(key)
    if found is None:
        found = frozenset(people_names(tables_of(snapshot)))
        if len(ROUND_NAMES) >= ROUND_NAMES_MOST:
            ROUND_NAMES.clear()
        ROUND_NAMES[key] = found
    return found


def met_names(logs, state=None):
    """The names of everyone the people table held in a save's turns so far (the tables each
    reply keeps), with the table, the bonded characters and the biographies of `state`."""
    names = set()
    for log in logs:
        if isinstance(log, dict) and log.get("stateSnapshot"):
            names |= round_names(log["stateSnapshot"])
    state = state or {}
    names |= people_names(state.get("currentState") or {})
    names |= {row_name(row) for row in (state.get("bondedCharacters") or {}).values()
              if isinstance(row, dict)}
    names |= {plain(str(entry.get("title") or "")).strip()
              for entry in state.get("worldBookEntries") or [] if isinstance(entry, dict)}
    return names - {""}


def turn_blocks(*, action, receipts, story, branches, before, after, notice=None, looks=None,
                chronicle=(), actions=None, perks=None, notes=()):
    """A turn's blocks in the contract's order: the action (or, for a verb of the cultivation
    life, its annals lines), the receipts settled before the story, the scene and the entrances,
    the story, what the story's commands changed, a scene's close, the options (or the life's
    action cards). `story` is the reply's or the log's story markup; `before` and `after` are
    play_state.Save readings of the save around the turn; `looks` the looks its places keep;
    `chronicle` the annals lines as blocks; `actions` the life's actions block; `perks` the
    悟得 on offer; `notes` the first-time notes the turn shows (their keys), just before the
    choices."""
    old, new = before.state.get("currentState") or {}, after.state.get("currentState") or {}
    options = options_block(branches)
    told = [block for block in story_blocks(story, Cast(new, old))
            if not echoes_options(block, options)]
    speech = [block for block in told if block["type"] == "speech"]
    blocks = [action] if action else []
    blocks += list(chronicle)
    for receipt in receipts:
        if not told_after(receipt):
            blocks += receipt_blocks(receipt)
    if scene := scene_block(before, after, looks):
        blocks.append(scene)
    met = met_names(before.data.get("logs") or [], before.state)
    blocks += entrances(old, new, known_people(before.state), speech, met)
    blocks += told
    blocks += delta_receipts(old, new, receipts)
    for receipt in receipts:
        if told_after(receipt):
            blocks += receipt_blocks(receipt)
    named = scene_title(receipts)
    if named:
        # The opening mark under the name the model gave the scene on its first beat.
        blocks = [{**block, "title": named} if block["type"] == "mark" and block["kind"] == "open"
                  else block for block in blocks]
    if notice:
        blocks.append(notice)
    # the first-time notes say what the choices below them are (or what the turn just showed)
    blocks += [note_block(key) for key in notes or () if key in FIRST_NOTES]
    if options:
        blocks.append(options)
    if actions:
        blocks.append(actions)
    if perks:
        blocks.append(perks)
    return numbered(blocks)


def echoes_options(block, options):
    """Whether a paragraph of the story only repeats the options: the model sometimes writes them
    into the story as well as into the branches (「A.提着油灯下入地窖……\\nB.……」), and the page
    shows them once, as the options (item 73's walkthrough: turn 15 written again)."""
    if block.get("type") != "narration" or not options:
        return False
    offered = {item["text"] for item in options["items"]}
    lines = [line.strip().strip("[]［］").strip()
             for line in str(block.get("text", "")).split("\n")]
    lines = [line for line in lines if line]
    return bool(lines) and all(
        OPTION_LETTER.match(line) and plain(OPTION_LETTER.sub("", line, count=1)).strip() in offered
        for line in lines
    )


# ---------------------------------------------------------------- turns already played

PENDING = {"type": "notice", "level": "warn", "text": "正文已保存，本回合状态待结算。",
           "action": "retry"}


OPENING = "<h4>天道初启</h4>"


def is_turn(log):
    """A turn's reply, settled or waiting to be: not the opening, a ghost, a summary or an undo
    backup. The director counts the settled ones the same way (card_director.is_turn), and the
    state view's turnNo is that count."""
    return (
        isinstance(log, dict)
        and log.get("type") == "ai"
        and not log.get("isGhost")
        and not log.get("isDeepSummary")
        and not log.get("isUndoSnapshot")
        and OPENING not in str(log.get("content") or "")
    )


def snapshot_state(logs, log, field, fallback):
    """The full state a log keeps (frxStateSnapshot or frxBeforeSnapshot), else the tables of
    its stateSnapshot over the fallback state; None when it keeps neither."""
    held = log.get(field)
    if held:
        try:
            resolved = resolve_snapshot(logs, held)
        except Exception:
            resolved = None
        if isinstance(resolved, dict) and isinstance(resolved.get("state"), dict):
            return resolved["state"]
    if field == "frxStateSnapshot" and log.get("stateSnapshot"):
        return {**fallback, "currentState": tables_of(log["stateSnapshot"])}
    return None


def log_annals(log):
    """The stored lines that belong to a turn, excluding prose-only and fight replies."""
    kind = log.get("frxKind")
    if kind and kind not in ("chronicle", "interrupted", "breakthrough"):
        return []
    return [entry for entry in log.get("frxChronicle") or [] if isinstance(entry, dict)]


def history(name, value, requests=None, looks=None, *, numbers=None):
    """Every turn of a save as the contract's turns, oldest first: the player's log before each
    reply as the action, the engine's receipts (from the turn's request when it is known, else
    read from the cards in the log), the story, the options; each place as the look it keeps
    (`looks`, else the rules'). With `numbers`, format only that page of absolute turn numbers.
    Earlier logs still supply snapshots, known characters and the previous options. Read only."""
    data = value["data"]
    logs = data.get("logs") or []
    requests = requests or {}
    turns, state = [], copy_state(data.get("state") or {})
    previous = {**state, "currentState": tables_of((logs[0] or {}).get("stateSnapshot")) if logs
                else {}}
    number = 0
    offered = []
    # A save of the cultivation life has no options: its latest turn ends with its action cards.
    playing = life_of(value)
    last = max((index for index, log in enumerate(logs) if is_turn(log)), default=None)
    last_line = next((index for index in range(len(logs) - 1, -1, -1)
                      if is_turn(logs[index]) and log_annals(logs[index])), None)
    has_latest_line = False
    for index, log in enumerate(logs):
        if not is_turn(log):
            continue
        number += 1
        if numbers is not None and number >= numbers.stop:
            break
        before = snapshot_state(logs, log, "frxBeforeSnapshot", state) or previous
        after = snapshot_state(logs, log, "frxStateSnapshot", state) or before
        if numbers is not None and number not in numbers:
            previous = after
            offered = branch_options(log.get("branchContent", ""))
            continue
        user = logs[index - 1] if index and logs[index - 1].get("type") == "user" else None
        request = requests.get(log.get("frxRequestId")) or {}
        settlement = request.get("settlement") or {}
        receipts = settlement.get("receipts")
        story = log.get("content") or log.get("unoptimizedContent") or ""
        if receipts is None:
            receipts = card_receipts(story_with_cards(story))
        reading = {"logs": logs[: index + 1], "archiveId": data.get("archiveId")}
        chronicle = [chronicle_block(entry) for entry in log_annals(log)]
        has_latest_line |= index == last_line
        if log.get("frxKind") == "chronicle":
            # A verb of the cultivation life: its annals lines, no action and no story.
            action, story = None, ""
        elif log.get("frxKind") == "passage":
            # 写一段: the passage the model wrote out of an annals line, and nothing else.
            action = None
        elif log.get("frxKind") in {"interrupted", "breakthrough"}:
            # A verb broken off by a scene, or an attempt at a gate: its annals lines, then the
            # scene's first beat or the gate's big scene.
            action = None
        elif log.get("frxKind") in {"fight", "fought"}:
            # A move in a fight: the move as the action and its round; the move that ended the
            # fight has the battle report as its story too.
            action = action_block(str(user.get("content") or "")) if user else None
            if log.get("frxKind") == "fight":
                story = ""
        elif request.get("played") and user and not request["played"].get("act"):
            action = played_action(request["played"], offered)
        else:
            action = action_block(user_action_text(user["content"], offered)) if user else None
        blocks = turn_blocks(
            action=action,
            receipts=receipts,
            story=story_of(story),
            branches="" if playing is not None else log.get("branchContent", ""),
            before=Save(name, 0, {"data": {**reading, "logs": logs[:index], "state": before}}),
            after=Save(name, 0, {"data": {**reading, "state": after}}),
            notice=PENDING if log.get("frxPending") else None,
            looks=looks,
            chronicle=chronicle,
            actions=actions_block(playing.get("cards"))
            if playing is not None and index == last and not playing.get("fight") else None,
            perks=perks_on_offer(playing) if index == last else None,
            notes=log.get("frxNotes") or (),
        )
        blocks = with_kept_ids(blocks, request.get("blockIds"))
        correction = settlement.get("bountyCorrection")
        if (isinstance(correction, dict) and request.get("status") == "committed"
                and correction.get("sourceRequest") == log.get("frxRequestId")
                and correction.get("archiveId") == data.get("archiveId")):
            lines = purse_line(correction)
            if lines and correction.get("amount") == correction["after"] - correction["before"] > 0:
                blocks.append({"id": "bounty-correction", "type": "receipt", "kind": "stones",
                               "title": "赏金补发", "lines": lines})
        # the book's volume and 回 the turn ended in (item 38), for the history's navigation
        book = ((after or {}).get("frxPlay") or {}).get("book") if playing is not None else None
        turns.append({"id": log.get("frxRequestId") or log.get("id") or f"t{number}",
                      "no": number, "status": "pending" if log.get("frxPending") else "done",
                      "blocks": blocks,
                      "at": str(log.get("timestamp") or ""),
                      **({"volume": book["volume"], "chapter": book["chapter"]}
                         if isinstance(book, dict) and isinstance(book.get("volume"), int)
                         and isinstance(book.get("chapter"), int) else {})})
        previous = after
        offered = branch_options(log.get("branchContent", ""))
    if has_latest_line:
        mark_latest_line(turns)
    return turns


def mark_latest_line(turns):
    """The save's latest annals line is the one shown as now (ChronicleBlock.now)."""
    for turn in reversed(turns):
        for block in reversed(turn["blocks"]):
            if block["type"] == "chronicle":
                block["now"] = True
                return


def copy_state(state):
    return {key: value for key, value in state.items() if key != "currentState"}


def story_with_cards(content):
    match = re.search(r"<content>([\s\S]*?)(?:</content>|$)", str(content or ""), re.I)
    return match[1] if match else str(content or "")


# ---------------------------------------------------------------- cards of turns already played

CARD = re.compile(r'<div\b[^>]*class="frx-(check|combat|receipt)-card"[^>]*>', re.I)


def card_receipts(story):
    """The engine's receipts of an old turn, read back from the cards its log shows (for a turn
    whose request is no longer known). Only what the card shows survives."""
    receipts = []
    for match in CARD.finditer(story):
        depth, end = 0, None
        for tag in re.finditer(r"<div\b|</div\s*>", story[match.start():]):
            depth += 1 if tag[0].startswith("<div") else -1
            if depth == 0:
                end = match.start() + tag.end()
                break
        card = story[match.start():end or len(story)]
        receipts.append(read_card(match[1].lower(), card))
    return [receipt for receipt in receipts if receipt]


def card_lines(card, name):
    return [plain(found) for found in re.findall(
        r'<div class="frx-' + name + r'"[^>]*>([\s\S]*?)</div>', card)]


def read_card(kind, card):
    if kind == "receipt":
        state = re.search(r'data-state="(\w+)"', card)
        label = re.search(r'<span class="frx-receipt-label">([\s\S]*?)</span>', card)
        summary = plain(re.sub(r'<span class="frx-receipt-label">[\s\S]*?</span>', "", card))
        kind = next((k for k, (_, title) in RECEIPT_KINDS.items()
                     if label and title == plain(label[1])), "")
        return {"kind": kind, "ok": not state or state[1] == "ok", "summary": summary.strip()}
    if kind == "check":
        title = (card_lines(card, "check-title") or [""])[0]
        roll = (card_lines(card, "check-roll") or [""])[0]
        result = (card_lines(card, "check-result") or [""])[0]
        if "突破" in title:
            return {"kind": "breakthrough", "ok": True, "summary": "；".join([title, result])}
        numbers = re.search(
            r"1d(\d+)\s*=\s*(-?\d+)\s*(\S+?)修正\s*([+-]?\d+)\s*总值\s*(-?\d+)", roll
        )
        heading = re.search(r"^(\S+?)检定(?: · (.+?))? · (\S+)（难度 (\d+)）", title)
        outcome = result.split("：", 1)
        if not numbers or not heading:
            return {"kind": "resolve_check", "ok": False, "summary": plain(card)}
        return {"kind": "resolve_check", "ok": True, "check": {
            "kind": heading[1], "target": {"name": heading[2]} if heading[2] else None,
            "tier": heading[3], "dc": int(heading[4]), "die": int(numbers[1]),
            "roll": int(numbers[2]), "attribute": numbers[3], "modifier": int(numbers[4]),
            "total": int(numbers[5]), "outcome": outcome[0],
            "consequence": outcome[1] if len(outcome) > 1 else "", "effects": [],
        }}
    if kind == "combat":
        return {"kind": "resolve_attack", "ok": False, "summary": "；".join(
            card_lines(card, "combat-title") + card_lines(card, "combat-strike"))}
    return None
