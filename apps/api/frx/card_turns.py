"""Engine-settled main turns for the standalone card (the tool-turn pilot).

The pilot keeps the original card's commands for everything the engine does not
own yet. Rule-governed results come from engine receipts; the model writes the
story from those receipts. See docs/architecture.md (一回合怎么走, 结算引擎).
"""

import asyncio
import json
import re
import time
from types import SimpleNamespace

from .card_snapshots import engine_payload, engine_result
from .domain import ROOT
from .gateway import ModelFailure

PILOT_SETTING = "FRX_TOOL_TURNS_V1"
HIDDEN_BLOCKS = (
    "thinking",
    "think",
    "upstore",
    "branches",
    "tablethink",
    "news_ref",
    "变量思考",
    "思考",
    "tag_think",
)
MAX_TOOL_ROUNDS = 2
# A tool decision is short; a stalled provider gets one fresh attempt.
TOOL_FIRST_CHUNK_SECONDS = 40
# A story normally starts within half a minute, but a busy provider can think for a
# minute or more. One that holds the reply past this is stalled (it fails at ~127s).
STORY_FIRST_CHUNK_SECONDS = 100


class TurnMetrics:
    """Latency, call and token accounting kept with every main-turn request."""

    def __init__(self, path):
        self.path = path
        self.started = time.monotonic()
        self.first_token_ms = None
        self.calls = 0
        self.tool_rounds = 0
        self.rewrites = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.cost = 0.0
        self.usage_reported = True
        self.call_ms = []
        self.stalls = 0
        self.empty_retries = 0
        self.retries = 0

    def first_token(self):
        if self.first_token_ms is None:
            self.first_token_ms = round((time.monotonic() - self.started) * 1000)

    def add_usage(self, usage):
        if not usage:
            self.usage_reported = False
            return
        get = usage.get if isinstance(usage, dict) else lambda key: getattr(usage, key, None)
        self.prompt_tokens += int(get("prompt_tokens") or 0)
        self.completion_tokens += int(get("completion_tokens") or 0)
        cost = get("cost")
        if isinstance(cost, (int, float)):
            self.cost += float(cost)

    def snapshot(self):
        return {
            "path": self.path,
            "calls": self.calls,
            "toolRounds": self.tool_rounds,
            "rewrites": self.rewrites,
            "firstTokenMs": self.first_token_ms,
            "totalMs": round((time.monotonic() - self.started) * 1000),
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "cost": round(self.cost, 6),
            "usageReported": self.usage_reported,
            "callMs": list(self.call_ms),
            "stalls": self.stalls,
            "emptyRetries": self.empty_retries,
            "retries": self.retries,
        }


_HIDDEN_NAMES = "|".join(map(re.escape, HIDDEN_BLOCKS))
_HIDDEN_BLOCK = re.compile(rf"<({_HIDDEN_NAMES})\s*>[\s\S]*?</\1\s*>", re.I)
_HIDDEN_OPEN = re.compile(rf"<(?:{_HIDDEN_NAMES})\s*>", re.I)
_CONTENT_BLOCK = re.compile(r"<content\s*>([\s\S]*?)(?:</content\s*>|$)", re.I)
_CONTENT_TAG = re.compile(r"</?content\s*>", re.I)
_EMPTY_CONTENT = re.compile(r"<content\s*>((?:\s|<[^>]*>)*?)</content\s*>", re.I)
_CONTENT_BLOCK_CLOSED = re.compile(r"<content\s*>[\s\S]*?</content\s*>", re.I)
_BLOCK_TAG = re.compile(r"<(/?)(content|upstore|branches)\s*>", re.I)
# The cultivation life's own blocks after the story (life_cards: the cards and a light scene's
# lines of what comes of them, the scene's name, its close and 回目, a volume's last words, the
# story threads): never words outside the content tags that could outweigh the story. A novel's
# reply has none.
_LIFE_BLOCK = re.compile(r"<(actions|scene|close|title|volume|threads)\s*>[\s\S]*?(?:</\1\s*>|$)",
                         re.I)


def has_words(text):
    """Whether markup has anything to read: more than tags and white space."""
    return bool(re.sub(r"<[^>]*>|\s", "", text or ""))


def _words(text):
    return len(re.sub(r"<[^>]*>|\s", "", text or ""))


def outweighs(outside, block):
    """Whether the words written outside the <content> tags are the story rather than the
    block: a full story outside and a marker inside (「<content>正文结束</content>」 after 915
    characters of story, in item 33's real-model playtest), not a preamble before the story."""
    return _words(outside) >= max(40, 3 * _words(block))


def _story(reply):
    """(the reply's story, whether it is the words outside the content tags)."""
    text = _HIDDEN_BLOCK.sub("", str(reply or ""))
    shown = _HIDDEN_OPEN.split(text, maxsplit=1)[0]
    outside = _CONTENT_TAG.sub("", _CONTENT_BLOCK.sub("", _LIFE_BLOCK.sub("", shown)))
    for block in _CONTENT_BLOCK.finditer(text):
        words = _HIDDEN_OPEN.split(block[1], maxsplit=1)[0]
        if has_words(words):
            if outweighs(outside, words):
                break
            return _CONTENT_TAG.sub("", words).strip(), False
    return outside.strip(), True


def reply_story(reply):
    """The story of a model's reply: the first <content> block with words in it, wherever it
    stands (a model may write its state block first, or close an empty pair after the story),
    unless the words outside the tags are a whole story and the block only a marker; without
    such a block, the words outside the reply's hidden blocks and content tags. Thoughts, state
    commands and branches are never the story, and a hidden block left open hides what follows
    it. StoryFilter streams the same story."""
    return _story(reply)[0]


def tidy_reply(reply):
    """The reply as the old page's readers (and the log the new interface builds with them)
    find reply_story's story in it: they take the first <content> pair, even an empty one, so
    empty pairs go, and when the story is the words outside the tags, the pairs that lost to it
    go too. Other replies come back unchanged."""
    reply = reply or ""
    if _story(reply)[1]:
        return _CONTENT_BLOCK_CLOSED.sub("", reply)
    return _EMPTY_CONTENT.sub("", reply)


CUT_SHORT = "模型的回复没有写完（中途被截断），请重试。"


def finished(reply):
    """A reply worth settling: it has a story and was not cut off inside a block."""
    return has_words(reply_story(reply)) and not cut_short(reply)


def cut_short(reply):
    """Whether a reply stops inside a block it opened: a <content> never closed and followed by
    no state or branches block, or a state or branches block left open. A provider may cut the
    output at its limit without saying so (item 33: 500 tokens, mid-word, no options)."""
    inside = None
    for match in _BLOCK_TAG.finditer(str(reply or "")):
        closing, name = match[1], match[2].lower()
        if name == "content" or name in ("upstore", "branches"):
            inside = None if closing else name
    return inside is not None


class StoryFilter:
    """Forward only the visible story while a reply streams, the story reply_story reads from
    the whole reply.

    Hidden blocks (state commands, branches, thoughts) are dropped and the content tags
    removed. Words outside the tags go out as they come. A <content> block with words is the
    story: when nothing was shown before it, it goes out as it comes; after words outside the
    tags, it is held to its end and then either replaces them (a None in `parts`: the caller
    discards what it showed) or, when they are the whole story and the block a marker
    (reply_story's rule), is dropped. Text after the story's block is withheld; an empty
    <content></content> pair is passed over. A partial tag at a chunk boundary waits for the
    next chunk.
    """

    TAG = re.compile(r"<(/?)([A-Za-z_一-鿿][\w一-鿿]*)\s*>")

    def __init__(self):
        self.buffer = ""
        self.hidden = None
        self.after_content = False
        self.in_content = False
        # The content block so far while it is held, and whether it goes out as it comes.
        self.held = ""
        self.live = False
        # The words that went out outside the content tags.
        self.outside = ""

    def feed(self, text):
        """The visible text in `text`, take-backs ignored (see `parts`)."""
        return "".join(part for part in self.parts(text) if part)

    def parts(self, text):
        """The visible pieces of `text`, in order, with None where what was shown before is
        taken back."""
        self.buffer += text
        out = []

        def emit(piece):
            if not piece:
                return
            if self.in_content and self.live:
                out.append(piece)
            elif self.in_content:
                self.held += piece
                if not has_words(self.outside) and has_words(self.held):
                    # Nothing shown before the block: it goes out as it comes.
                    out.append(self.held)
                    self.held, self.live = "", True
            elif not self.after_content:
                out.append(piece)
                self.outside += piece

        def close_block():
            self.in_content = False
            held, self.held = self.held, ""
            if self.live:
                self.after_content = True
            elif has_words(held) and not outweighs(self.outside, held):
                out.extend([None, held])
                self.after_content = True
            # An empty pair, or a marker after the whole story: passed over.

        while self.buffer:
            if self.hidden:
                close = re.search(r"</" + re.escape(self.hidden) + r"\s*>", self.buffer, re.I)
                if not close:
                    # Keep only what could still start the closing tag.
                    self.buffer = self.buffer[-(len(self.hidden) + 3) :]
                    break
                self.buffer = self.buffer[close.end() :]
                self.hidden = None
                continue
            start = self.buffer.find("<")
            if start < 0:
                emit(self.buffer)
                self.buffer = ""
                break
            emit(self.buffer[:start])
            self.buffer = self.buffer[start:]
            match = self.TAG.match(self.buffer)
            if match:
                closing, name = match.group(1), match.group(2).lower()
                self.buffer = self.buffer[match.end() :]
                if name in HIDDEN_BLOCKS and not closing:
                    self.hidden = name
                elif name == "content":
                    if not closing and not self.in_content and not self.after_content:
                        self.in_content, self.live, self.held = True, False, ""
                    elif closing and self.in_content:
                        close_block()
                else:
                    emit(match.group(0))
                continue
            if ">" not in self.buffer and len(self.buffer) < 24:
                break
            emit("<")
            self.buffer = self.buffer[1:]
        return out


async def run_engine(payload, timeout=10):
    """Run the original-card rule engine in an isolated Node process. The save goes with a marker
    in place of each of the server's own round snapshots, which the engine never reads, and a save
    it returns has them back (card_snapshots.engine_payload)."""
    payload, held = engine_payload(payload)
    process = await asyncio.create_subprocess_exec(
        "node",
        str(ROOT / "apps/engine/settle.cjs"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output, _ = await asyncio.wait_for(
            process.communicate(json.dumps(payload, ensure_ascii=False).encode()),
            timeout=timeout,
        )
        return engine_result(json.loads(output), held)
    except (TimeoutError, ValueError):
        raise ModelFailure("状态结算未完成，原始回复已保留") from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


# ---------------------------------------------------------------- pilot turn
import html as _html  # noqa: E402
import inspect as _inspect  # noqa: E402
import os as _os  # noqa: E402
from pathlib import Path as _Path  # noqa: E402

PILOT_PRESET = """你是《云汀修行录》文字RPG的叙事者。依据当前状态、玩家行动、世界书和【引擎回执】推进剧情。
每次回复严格使用 <content>正文</content><upstore>其余状态指令</upstore><branches>[A.行动][B.行动][C.行动][D.行动]</branches>。
正文用中文，约600字。不要输出内部推理。指令的每个参数必须是严格JSON，键和字符串用双引号。
当前采用全年龄冒险叙事，行动分支围绕探索、交涉、修炼和抉择，不更新亲密行为字段。
【引擎结算】道具的使用与领取、买卖、装备、技能消耗、战斗交锋、行动检定、任务结算、修炼与突破都由引擎完成，结果见【引擎回执】或工具结果。正文必须与结算一致：成功的，写出实际发生的过程和效果；失败的，写明原因，不得写出使用效果或领取成功。交锋的命中、伤害与倒地以回执为准，不要另写数值。不要自行掷骰，不要输出判定框HTML。
正文是小说叙述：不写血量、法力、修为进度等属性名和数值，不照搬回执与工具结果的原话，改用剧情里的说法，例如写“气血充盈，无伤可治”，不写“血量已满”。
upstore只写结算之外的变化：时间地点、人物、任务、灵石、世界事件、地图和总结。不得改动结算中的道具数量、装备、法力、血量、技能熟练度、任务状态与灵石，也不要扣减储物袋中的消耗品。玩家的修为进度与境界只由引擎结算，不要写。玩家想用、但本回合没有结算的道具，正文写明尚未使用。
主角的灵石记在B1第26列「当前灵石」，是下品灵石的块数（中品灵石按100块折算），不进储物袋。剧情里主角得到灵石（报酬、搜刮、捡到、赠予）或付出灵石（车资、房钱、打点）而没有经过结算时，用add("B1",{"26":"新的总数"})记账。
只写本回合确有变化的实体和列，没变的不重写。新出场的人物写名称、境界身份、性格与外貌即可，属性面板由引擎按境界生成，不必逐条写updateAttribute。
更新与删除使用当前已有的实体ID。新人物、新物品用未占用的ID新增，【离场人物】的编号仍被占用。人物离开、被带走或身死后已不在主角眼前的，用de("ID")移出在场人物；交战中仍站着的敌人不能这样移出。人物在结算之外受伤或治疗时，按回合前血量计算结果并写入第11列，例如updateAttribute("B1","血量",{"current":29,"max":50})。第9列用于备注。
指令只用这几种写法：新增行set({"0":"ID",...})，更新行add("ID",{"列号":值})，删除行de("ID")，属性updateAttribute("ID","属性",{"current":数值,"max":数值})，不得使用JSON Patch等其他格式。
set用于新增行，add用于更新现有行。物品和资源收支须配套，不能凭空给玩家奖励。
无状态变化也必须输出空的upstore。总结用addSmallSummary和addLargeSummary，每回合都写。"""  # noqa: E501

TOOL_GUIDE = (
    "【工具】本回合可调用：{names}。玩家要使用或领取道具时先调用工具结算；需要交涉，"
    "或角色可能受伤时调用resolve_check，由引擎掷骰并给出后果。拿到工具结果后再写完整回复，"
    "同一件事不要重复调用。玩家所指的道具有多件同名时，先查询储物袋，不要替玩家选择，"
    "正文请玩家指明是哪一件。只能从在场人物实际持有的道具或已完成任务的奖励中领取道具。"
    "先取得再使用时，在同一次回复里先调用claim_item，再用同一个道具ID调用use_item。"
)
TOOL_HINTS = {
    "resolve_check": (
        "交涉、跌落陷阱等非交锋的受伤，以及战斗中逃跑（脱身）用resolve_check；"
        "寻常的问话、打听和照价买卖不必检定。"
    ),
    "trade_item": (
        "买卖或以物易物谈妥成交时调用trade_item，price填成交总价，折合下品灵石（一块中品灵石合一百块下品）；"
        "只是询价、讨价还价而没有成交的不要调用。买下即用的，先调用trade_item，再以物品名称调用use_item。"
    ),
    "resolve_attack": (
        "动手交锋时，玩家、同伴或敌人每出手一次调用一次resolve_attack，命中、伤害与对方反击由引擎结算；"
        "不是真正动手的（如拍打草叶、劈柴）不要调用。投石问路、打草惊蛇、试探或引出暗处之物，"
        "不是对敌人出手，也不要调用：因此现身的对手写进正文、用set新增，等有人真正出手时再结算。"
        "新出现的敌人不填ID，给出名称和境界，"
        "之后用返回的编号；成群的小兽按一个整体登记。敌人主动袭击时出手者填敌人、目标填B1。"
        "对方倒地后是否了结由剧情决定。"
    ),
    "use_skill": (
        "战斗之外施展已习得的技能时调用use_skill；战斗中出招在resolve_attack里填skill_id；"
        "打坐修炼不必调用。"
    ),
    "move_place": (
        "主角动身去另一个地图地点（出城往白苇集、回宗门）时调用move_place，路上的日子、被打扰和到达由引擎结算，"
        "正文照回执写；没有move_place的回执，时间行里不要把地点改成另一个地图地点。在同一个地点里走动"
        "（泊灯城的客栈到茶肆）不必调用。时间行地点写本回合结束时实际站的位置；潜渡写出口，别写中途的入口。"
    ),
    "prove_lead": (
        "正文写到主角在这一场戏里查实了一条疑点（【未回收的伏笔】里的编号，如F3）时调用prove_lead；"
        "引擎核对这场戏里有过一次成功的检定，核不过就拒，正文照回执写成还没查实。"
    ),
    "note_karma": (
        "主角和在场的人之间结下一笔因果时调用note_karma：恩是别人欠主角的（主角救了他、帮了他），"
        "怨是别人恨主角的，债是主角欠别人的（借了钱、受了人情），诺是主角答应别人的事（days写几日之内办到）；"
        "了结一笔（还了、报了、办成了）写done，填账本里的编号。寻常的寒暄和买卖不记。"
    ),
    "note_knot": (
        "主角做了亏心的事（背弃同伴、滥杀、失信、见死不救、夺人机缘）时调用note_knot登记一桩心结，"
        "写明是谁、什么事；当事人要在场或刚死。和当事人（死了就是他的后人）把这件事了断时，"
        "写resolve填心结的编号，后人了断的把heir设为true。"
    ),
    "grant_chance": (
        "grant_chance只在这一场戏的正文明明白白给了主角一桩冲击下一个大境界的大机缘时调用一次："
        "前人的传承、上古洞府的遗泽、高人当面指点关隘，reason写明是什么机缘；这样的事极少，"
        "一个大境界至多一回，寻常的收获、丹药法宝、灵石、修为、口头许诺都不算，拿不准就不调用。"
    ),
    "rest": (
        "玩家打坐、休息或睡觉时调用rest，hours按剧情实际经过的时间换算成小时，法力与血量由引擎恢复；"
        "只是坐下喘口气的不必调用。恢复法力血量用rest，增进修为用cultivate。"
    ),
    "cultivate": (
        "增进修为用cultivate（mode填修炼），duration与unit按剧情实际修炼的时长填写（一个时辰为2小时，修炼一夜约8小时，「到天亮」「到天黑」按时间行算到那时；闭关数日按日、数月按月），aura按当地灵气如实选："
        "凡俗城镇为薄，寻常山野与宗门为中，灵脉、灵眼、洞府、灵泉、福地才是浓；要耗用灵石的把use_stones设为true。"
        "只为恢复法力血量的打坐调息用rest，不用cultivate。奇遇、顿悟、吞服天材地宝这类真正的机缘才用mode机缘，"
        "并按分量选fortune档位、在source写明来由；寻常修炼、口头许诺都不是机缘。修为增长、晋升、到瓶颈出关、"
        "时间与年龄都以回执为准，时间行只需按剧情更新地点。"
    ),
    "breakthrough": (
        "玩家在大境界的瓶颈且修为圆满时冲击下一个境界（引气入体、筑基、结丹……）调用breakthrough；"
        "修为只差一日之功的，引擎在冲关前先替玩家补足。"
        "服用的辅助丹药按储物袋ID每枚一项填进aid_item_ids，不要另用use_item服下。修为未满、缺灵根或功法、"
        "冷却未过都会被拒绝，正文照回执写明缺什么。成败、境界、寿元、伤势与冷却以回执为准。"
        "没有成功的突破回执，正文不得写主角突破、引气入体成功或境界提升。"
    ),
    "update_quest": (
        "本回合有进行中的任务完成、失败或放弃时调用update_quest，剧情自然了结的也一样"
        "（护送到达、成功脱险、采到所需之物），不要在upstore里直接改任务的第5列。"
        "完成时按任务登记的奖励领取：奖励就是本回合亲手得到的东西（如采到的灵药）时，用rewards领取，"
        "不要再用set另建一份；要回去交差才拿得到的奖励，这次不填，交差时再领。"
        "择一的奖励只选一组，名称只写物品名并照抄登记写法，数量另填。任务尚未真正了结时不要调用。"
    ),
}


def tool_guide(names, *, life=False):
    hints = "".join(TOOL_HINTS[name] for name in names if name in TOOL_HINTS)
    guide = ("【工具】本回合可调用：{names}。只在确有需要时调用所列工具，"
             "不调用未提供的工具。行动卡、耗物、检定、斗法和修行已由引擎结算，"
             "照已有回执写，不重复执行。" if life else TOOL_GUIDE)
    return guide.format(names="、".join(names)) + hints


TOOL_SPECS = {
    "lookup_inventory": {
        "type": "function",
        "function": {
            "name": "lookup_inventory",
            "description": "查询玩家储物袋，返回道具ID、名称、数量、描述和效果。只读，不改变状态。",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "可选，按名称筛选"}},
            },
        },
    },
    "use_item": {
        "type": "function",
        "function": {
            "name": "use_item",
            "description": (
                "玩家服用或使用储物袋中的一件消耗品。引擎校验库存、境界与每日限次，"
                "并结算扣减和效果。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "string", "description": "储物袋道具ID，如I1"},
                    "quantity": {"type": "integer", "minimum": 1},
                },
                "required": ["item_id", "quantity"],
            },
        },
    },
    "claim_item": {
        "type": "function",
        "function": {
            "name": "claim_item",
            "description": "玩家从在场人物手中接过其实际持有的道具，或领取已完成任务登记的奖励。",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_id": {
                        "type": "string",
                        "description": "人物ID（C或G开头）或任务ID（T开头）",
                    },
                    "item_id": {
                        "type": "string",
                        "description": "人物持有的道具ID，或任务奖励中的道具名称",
                    },
                    "quantity": {"type": "integer", "minimum": 1},
                },
                "required": ["source_id", "item_id", "quantity"],
            },
        },
    },
    "recall_memory": {
        "type": "function",
        "function": {
            "name": "recall_memory",
            "description": (
                "按人物、地点或事件查找本存档当前时间线上的旧事记忆，结果带来源回合和出处。只读。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要回忆的事"},
                    "person": {"type": "string", "description": "可选，相关人物名"},
                    "place": {"type": "string", "description": "可选，相关地点名"},
                },
                "required": ["query"],
            },
        },
    },
    "resolve_attack": {
        "type": "function",
        "function": {
            "name": "resolve_attack",
            "description": (
                "结算一次交锋：出手者攻击目标，引擎掷骰判定命中与伤害，目标未倒地且能还手时自动反击一次。"
                "境界压制、身法、装备与技能都计入。玩家、同伴或敌人每出手一次调用一次。"
                "新出现的敌人不填ID，给出名称和境界，引擎登记编号并在结果中返回。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "attacker_id": {
                        "type": "string",
                        "description": (
                            "出手者ID，默认B1（玩家）。尚未登记的敌人先出手时留空，"
                            "并填attacker_name与attacker_realm"
                        ),
                    },
                    "attacker_name": {"type": "string", "description": "未登记的出手者名称"},
                    "attacker_realm": {"type": "string", "description": "未登记的出手者境界"},
                    "target_id": {
                        "type": "string",
                        "description": "目标ID。尚未登记的敌人留空，并填target_name与target_realm",
                    },
                    "target_name": {"type": "string", "description": "未登记的目标名称"},
                    "target_realm": {
                        "type": "string",
                        "description": "未登记目标的境界，如凡人、炼气三层、筑基初期、一阶妖兽",
                    },
                    "style": {
                        "type": "string",
                        "enum": ["物理", "法术"],
                        "description": "物理以物攻对物防；法术以法攻对法防并消耗法力",
                    },
                    "skill_id": {"type": "string", "description": "出手所用的已习得技能ID，可空"},
                    "ambush": {
                        "type": "boolean",
                        "description": "对方毫无防备时的偷袭为true，偷袭时对方来不及还手",
                    },
                    "counter": {
                        "type": "boolean",
                        "description": "目标无力或不愿还手（逃跑、昏迷、被缚）时为false",
                    },
                    "reason": {"type": "string", "description": "招式与意图，十余字"},
                },
                "required": ["reason"],
            },
        },
    },
    "use_skill": {
        "type": "function",
        "function": {
            "name": "use_skill",
            "description": (
                "玩家在战斗之外施展一门已习得的技能或法术。引擎扣除消耗、核对每日次数与冷却，"
                "并增长熟练度；消耗不足时不能施展。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {"type": "string", "description": "技能ID，S开头"},
                    "target_id": {"type": "string", "description": "作用对象的人物ID，可空"},
                    "reason": {"type": "string", "description": "施展缘由，十余字"},
                },
                "required": ["skill_id", "reason"],
            },
        },
    },
    "update_quest": {
        "type": "function",
        "function": {
            "name": "update_quest",
            "description": (
                "玩家完成、失败或放弃一项进行中的任务时调用。完成时可领取任务登记的奖励，"
                "择一的奖励只能选一组，引擎核对数量后发放并标记已领取；灵石记入当前灵石。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "quest_id": {"type": "string", "description": "任务ID，T开头"},
                    "status": {"type": "string", "enum": ["完成", "失败", "放弃"]},
                    "rewards": {
                        "type": "array",
                        "description": (
                            "领取的登记奖励。name只写物品或灵石的名称，照抄登记写法，如碎灵砂、下品灵石；"
                            "数量写在quantity，不要把整句奖励说明当名称。没有实物的奖励不必领取"
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "quantity": {"type": "integer", "minimum": 1},
                            },
                            "required": ["name", "quantity"],
                        },
                    },
                    "reason": {"type": "string", "description": "了结缘由，十余字"},
                },
                "required": ["quest_id", "status", "reason"],
            },
        },
    },
    "move_place": {
        "type": "function",
        "function": {
            "name": "move_place",
            "description": (
                "修仙人生的存档里，主角动身去另一个地图地点时调用：引擎按地图上的路程和主角的脚力"
                "推进时间、改当前地点，路上可能被打扰。同一个地图地点里换去处不用调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "目的地，地图上的地名，如白苇集"},
                    "reason": {"type": "string", "description": "为什么去，一句话"},
                },
                "required": ["to", "reason"],
            },
        },
    },
    "prove_lead": {
        "type": "function",
        "function": {
            "name": "prove_lead",
            "description": (
                "修仙人生的存档里，主角在这一场戏里查实了一条疑点时调用：引擎核对这条疑点在、"
                "这场戏里有过一次成功的检定，核不过就拒。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "疑点的编号，如F3"},
                    "how": {"type": "string", "description": "怎么查实的，一句话"},
                },
                "required": ["id", "how"],
            },
        },
    },
    "note_karma": {
        "type": "function",
        "function": {
            "name": "note_karma",
            "description": (
                "修仙人生的存档里，记一笔因果（恩、怨、债、诺），或了结账本里的一笔。"
                "引擎核对这个人在场。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["恩", "怨", "债", "诺"],
                             "description": "恩：别人欠主角的；怨：别人恨主角的；"
                             "债：主角欠别人的；诺：主角答应别人的事"},
                    "who": {"type": "string", "description": "在场人物的编号，如C2"},
                    "what": {"type": "string", "description": "什么事，一句话，不超过60字"},
                    "back": {"type": "string", "description": "可能怎么找回来，一句话，可空"},
                    "days": {"type": "integer", "minimum": 1, "maximum": 3600,
                             "description": "诺：几日之内办到"},
                    "done": {"type": "string",
                             "description": "了结账本里的哪一笔（编号，如Y3）；写了它就不用写别的"},
                    "how": {"type": "string", "description": "了结时：怎么了结的，一句话"},
                },
            },
        },
    },
    "note_knot": {
        "type": "function",
        "function": {
            "name": "note_knot",
            "description": (
                "修仙人生的存档里，登记一桩心结，或了结一桩。引擎核对当事人在场或刚死；"
                "了结要当事人在场，当事人不在人世了要他的后人在场。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string",
                             "enum": ["背弃同伴", "滥杀", "失信", "见死不救", "夺人机缘"]},
                    "who": {"type": "string",
                            "description": "当事人的编号，如C2；了结时是在场的当事人或他的后人"},
                    "name": {"type": "string", "description": "当事人的名字（他已不在人物表里时）"},
                    "what": {"type": "string", "description": "什么事，一句话，不超过60字"},
                    "resolve": {"type": "string", "description": "了结哪一桩心结（编号，如J2）"},
                    "heir": {"type": "boolean", "description": "了结时who是当事人的后人"},
                    "how": {"type": "string", "description": "了结时：偿还、了断还是祭奠，一句话"},
                },
            },
        },
    },
    "grant_chance": {
        "type": "function",
        "function": {
            "name": "grant_chance",
            "description": (
                "修仙人生的存档里，这一场戏明明白白给了主角一桩冲击下一个大境界的大机缘（前人传承、"
                "上古洞府的遗泽、高人指点关隘）时调用，引擎记在下一道关上；极少，寻常收获不算。"
                "不在戏里、下一关已有机缘、再往上没有关时引擎拒绝。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string",
                               "description": ("什么机缘，一句话，不超过40字，"
                                               "如「古修洞府里得了一枚化神感悟玉简」")},
                },
                "required": ["reason"],
            },
        },
    },
    "rest": {
        "type": "function",
        "function": {
            "name": "rest",
            "description": (
                "玩家打坐调息、休息或睡眠一段时间，引擎按时长恢复法力与血量。"
                "战斗中不能休整；血量从零回升即解除重伤倒地。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["打坐", "休息", "睡眠"]},
                    "hours": {
                        "type": "number",
                        "minimum": 0.5,
                        "description": "剧情中实际经过的时长，小时计，一个时辰为2小时",
                    },
                    "reason": {"type": "string", "description": "休整缘由，十余字"},
                },
                "required": ["kind", "hours", "reason"],
            },
        },
    },
    "cultivate": {
        "type": "function",
        "function": {
            "name": "cultivate",
            "description": (
                "结算一段修炼或一次机缘带来的修为。修炼：按时长、灵根、功法、灵气与灵石由引擎算出修为增长，"
                "修为满100自动晋升小境界，到大境界的瓶颈即出关，推进时间行与年龄，修炼满一日法力血量回满；"
                "战斗中、重伤倒地时不能修炼。机缘：奇遇、顿悟、吞服灵物带来的修为，由引擎按档位给值，"
                "有次数限制，超出时降档，不推进时间。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "enum": ["修炼", "机缘"]},
                    "duration": {
                        "type": "number",
                        "minimum": 0,
                        "description": "修炼时长的数值，单位见unit；机缘不填",
                    },
                    "unit": {"type": "string", "enum": ["小时", "日", "月", "年"]},
                    "aura": {
                        "type": "string",
                        "enum": ["无", "薄", "中", "浓"],
                        "description": (
                            "所在地的灵气：凡俗城镇为薄，寻常山野、宗门为中，"
                            "灵脉、灵眼、洞府、灵泉、福地为浓"
                        ),
                    },
                    "use_stones": {
                        "type": "boolean",
                        "description": "是否耗用灵石辅助修炼，按境界每日消耗下品灵石",
                    },
                    "fortune": {
                        "type": "string",
                        "enum": ["小", "中", "大"],
                        "description": "机缘的分量：小为寻常感悟，中为难得奇遇，大为改命级的造化",
                    },
                    "source": {"type": "string", "description": "机缘的来由，如顿悟、服下朱果"},
                    "reason": {"type": "string", "description": "缘由，十余字"},
                },
                "required": ["mode", "reason"],
            },
        },
    },
    "breakthrough": {
        "type": "function",
        "function": {
            "name": "breakthrough",
            "description": (
                "玩家在大境界的瓶颈（凡人、炼气十三层、各境界后期）且修为圆满时冲击下一个大境界。"
                "引擎核对灵根、功法与冷却，掷骰判定成败，结算境界、属性、寿元、修为回落、伤势与冷却，"
                "并按关卡推进时间。辅助丹药无论成败都消耗，最多计两枚。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "aid_item_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "服用的辅助丹药在储物袋中的ID，每枚一项；没有就留空",
                    },
                    "reason": {"type": "string", "description": "冲关缘由，十余字"},
                },
                "required": ["reason"],
            },
        },
    },
    "trade_item": {
        "type": "function",
        "function": {
            "name": "trade_item",
            "description": (
                "结算一笔谈妥的买卖：买入时引擎核对并扣除玩家的灵石（或抵价的道具）、把货物放进储物袋；"
                "卖出时从储物袋取出道具、把灵石记入当前灵石。成交价由剧情决定，引擎只核对付得起、拿得出。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["买入", "卖出"]},
                    "item_name": {"type": "string", "description": "买入的物品名称，不带数量"},
                    "item_id": {"type": "string", "description": "卖出时储物袋中的道具ID"},
                    "quantity": {"type": "integer", "minimum": 1},
                    "price": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "成交总价，折合下品灵石；完全以物易物时为0",
                    },
                    "pay_item_id": {
                        "type": "string",
                        "description": "以储物袋中的道具抵价时填它的ID，可空",
                    },
                    "pay_quantity": {"type": "integer", "minimum": 1},
                    "item_type": {
                        "type": "string",
                        "enum": [
                            "消耗品",
                            "材料",
                            "重要物品",
                            "其他物品",
                            "武器",
                            "护甲",
                            "功法",
                            "法宝",
                        ],
                    },
                    "description": {"type": "string", "description": "买入物品的描述"},
                    "effect": {
                        "type": "string",
                        "description": "买入物品的效果，如“恢复20点血量”；没有效果写“无”",
                    },
                    "counterpart_id": {"type": "string", "description": "交易对象的人物ID，可空"},
                    "reason": {"type": "string", "description": "交易缘由，十余字"},
                },
                "required": ["direction", "quantity", "price", "reason"],
            },
        },
    },
    "resolve_check": {
        "type": "function",
        "function": {
            "name": "resolve_check",
            "description": (
                "进行一次行动检定。只选择检定种类和难度档，骰点、修正与后果由引擎依规则表结算。"
                "难度档按所求之事的分量与风险选择。交涉只在对方可能拒绝时检定，问路、打听寻常消息、照价买卖不必检定："
                "请人行举手之劳、打听不便明说的消息为易；请人帮忙、讨价还价为中；"
                "求取功法秘传、借贵重之物、劝人违背本意为难；几无可能的要求为极难。受伤（非交锋）：寻常磕碰为易；"
                "失足跌落、误触陷阱为中；从数丈高处跃下、硬接修士法术余波为难；必死之局为极难。"
                "脱身：甩开凡人或同阶对手为中；从高一阶的对手手下逃走为难；从高出一个大境界者手中逃生为极难。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["交涉", "受伤", "脱身"]},
                    "tier": {"type": "string", "enum": ["易", "中", "难", "极难"]},
                    "target_id": {
                        "type": "string",
                        "description": "交涉对象或伤害来源的人物ID，可空",
                    },
                    "reason": {"type": "string", "description": "检定缘由，十余字"},
                },
                "required": ["kind", "tier", "reason"],
            },
        },
    },
}


MEMORY_WORDS = re.compile(
    r"还记得|记得|上次|之前|当初|那天|曾经|以前|先前|提到过|说过|旧事|往事|回想|想起"
)


def wants_memory(text):
    return bool(MEMORY_WORDS.search(text or ""))


def live_memory(value, archive_id, live_logs):
    """A memory is recallable only while all of its source turns are on this timeline."""
    if not value or value.get("scope") != "archive" or value.get("archiveId") != archive_id:
        return False
    if value.get("outdatedTimestamp") or value.get("frxTimelineHidden"):
        return False
    sources = (value.get("frxSource") or {}).get("logIds") or []
    return all(source in live_logs for source in sources)


def pilot_flag(setting, archive, name, default=False):
    """Whether a save's turns go through engine settlement.

    A save switched off (an explicit false) stays off and one switched on stays on. Every other
    save follows the default, which the caller sets on when the model has passed tool admission:
    without tools the engine could not settle fights, trades and checks.
    """
    archives = (setting or {}).get("archives") or {}
    data = (archive or {}).get("data") or {}
    keys = [key for key in (data.get("archiveId"), name) if key]
    if any(archives.get(key) is False for key in keys):
        return False
    return any(archives.get(key) for key in keys) or bool(default)


def admission_path():
    return _Path(_os.getenv("FRX_DATA_DIR", ROOT / ".frx")) / "tool-admission.json"


def admission(model):
    try:
        return json.loads(admission_path().read_text()).get("models", {}).get(model) or {}
    except (OSError, ValueError):
        return {}


def tool_capable(model):
    return bool(admission(model).get("passed"))


COMBAT_ENTRY = (
    "【战斗】交锋一律由引擎的resolve_attack工具结算：命中、伤害、境界压制、身法与反击都按引擎规则计算，"
    "结果见工具回执。正文按回执描写招式往来与胜负，不自行掷骰，不按境界倍数换算，不输出判定框。"
    "敌人主动出手时同样调用resolve_attack，出手者填敌人。"
)


INTIMATE_COLUMN = re.compile(r"^\s*(?:8|17|18|20|21|22|23|24)\s*[:：]")
ANY_COLUMN = re.compile(r"^\s*\d+\s*[:：]")
PILOT_VARIABLE_EDITS = (
    # Only what this turn changed is written; restating every value lengthens every reply.
    (r"必须全面更新变量，不能遗漏每一项", "本回合有变化的变量都要更新，不能遗漏"),
    (
        r"每次都要更新\{\{user\}\}的情况以及周围npc的所有信息",
        "只更新本回合确有变化的人物与列，没有变化的不要重写",
    ),
    # The engine generates a new character's panel and settles fights, items, rest and spells.
    (
        r"\{\{user\}\}与NPC的属性每次都必须更新，?会随着境界提升而变化",
        "NPC只在境界突破或剧情确实改变属性时更新；新出场人物的属性面板由引擎按境界生成，"
        "战斗、道具、休整与施法带来的增减由引擎结算，{{user}}修炼与突破带来的属性变化也由引擎结算",
    ),
    # The player's progress and realm are the engine's in these turns.
    (
        r"\| 修为进度\s*\|[^\n]*",
        "| 修为进度 | 修为进度与境界由引擎结算，不要写 |",
    ),
    # Health lives in column 11, where the engine settles it.
    (
        r'示例 \(更新玩家状态和血量\): add\("B1", \{"4": "身负轻伤", "9": \{"hp": "85/100"\}\}\)',
        '示例 (更新玩家状态): add("B1", {"4": "身负轻伤"})',
    ),
    (
        r"\| hp \|[^\n]*",
        '| hp | 血量写在第11列，用updateAttribute("B1","血量",{"current":数值,"max":数值})更新，'
        "不写在备注里 |",
    ),
    # The all-ages examples for the appearance column.
    (
        r'【完美示例】: "[^"\n]*"',
        '【完美示例】: "拄着药锄立在药垄间|粗布短褂，裤脚沾泥|白苇集北麓药圃 980,520|'
        '身形精瘦，肩背微驼|面色黝黑，眉目和善"',
    ),
    (
        r'【错误示例】: "[^"\n]*"',
        '【错误示例】: "拄着药锄立在药垄间，穿粗布短褂，面色黝黑，眉目和善。'
        '|白苇集北麓药圃 980,520"',
    ),
)


def pilot_variables(text):
    """The card's state rules for engine-settled turns: no intimacy columns, nothing restated
    that did not change, and the panels and health the engine generates or settles."""
    kept, skipping = [], False
    for line in text.split("\n"):
        if INTIMATE_COLUMN.match(line):
            skipping = True
        elif ANY_COLUMN.match(line):
            skipping = False
        if not skipping:
            kept.append(line)
    text = "\n".join(kept)
    for pattern, replacement in PILOT_VARIABLE_EDITS:
        text = re.sub(pattern, lambda _, value=replacement: value, text)
    return text


def pilot_entry(entry):
    """Rules stay; hand-written judgment HTML and model-side dice go."""
    name = entry.get("comment") or entry.get("name") or ""
    if name == "骰子池":
        return None
    if name == "战斗判定":
        # The original asks the model to roll and to double the difficulty per minor realm;
        # in pilot turns the engine's combat rules replace all of it.
        return {**entry, "content": COMBAT_ENTRY}
    if name.startswith("变量思考"):
        return {**entry, "content": pilot_variables(entry.get("content", ""))}
    if "判定" in name:
        text = re.sub(r"<div[\s\S]*</div>", "", entry.get("content", ""))
        kept = []
        for line in text.split("\n"):
            # Presentation instructions go; the judgment rules themselves stay.
            if re.search(
                r"美化|HTML结构|输出指令|判定框|按照以下.*判定输出|按以下.*判定输出|判定公式执行|判定结果呈现|直接输出在正文",
                line,
            ):
                continue
            line = re.sub(r"判定HTML输出后", "拿到检定结果后", line)
            line = re.sub(
                r"1dx\s*投掷结果请从公平骰池中选取骰子，?禁止随机。?",
                "检定调用resolve_check工具，由引擎掷骰，禁止自行编造骰点。",
                line,
            )
            kept.append(line)
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
        entry = {
            **entry,
            "content": text + "\n检定由引擎的resolve_check工具结算，按工具结果叙述，不输出判定框。",
        }
    return entry


def receipts_text(receipts):
    lines = [
        f"- {r.get('id', '')} {r.get('summary', '')}" for r in receipts if not r.get("readOnly")
    ]
    if not lines:
        return ""
    timed = any(r.get("ok") and (r.get("time") or {}).get("minutes") for r in receipts)
    # Stones are the engine's only in a turn whose receipts moved them; otherwise the story books
    # what it gives or takes.
    stones = any(r.get("ok") and (r.get("owns") or {}).get("currency") for r in receipts)
    return (
        "\n【引擎回执（本回合已结算，正文必须一致）】\n"
        + "\n".join(lines)
        + "\n以上变化已由引擎写入存档，upstore不要再写这些道具数量、装备、法力、"
        "血量（包括备注中的hp）、技能熟练度、任务状态、"
        + (
            "灵石、修为进度与境界。"
            if stones
            else "修为进度与境界。回执之外剧情里主角得到或付出的灵石，"
            '照常用add("B1",{"26":"新的总数"})记账。'
        )
        + ("时间已由引擎推进到回执所写的日期，时间行只需按剧情更新地点。" if timed else "")
    )


def receipt_card(receipt):
    escape = _html.escape
    if receipt.get("quiet"):
        # A refusal that settled nothing (a call on a quest no longer under way): no card.
        return ""
    if receipt.get("kind") == "resolve_check" and receipt.get("ok"):
        c = receipt["check"]
        target = f" · {escape(c['target']['name'])}" if c.get("target") else ""
        effects = "".join(
            '<div class="frx-check-effect">战斗结束</div>'
            if e.get("endsCombat")
            else f'<div class="frx-check-effect">{escape(e["stat"])} {e["before"]} → '
            f"{e['after']} / {e['max']}</div>"
            for e in c.get("effects", [])
        )
        modifier = c["modifier"]
        return (
            f'<div class="frx-check-card" data-outcome="{escape(c["outcome"])}">'
            f'<div class="frx-check-title">{escape(c["kind"])}检定{target} · '
            f'{escape(c["tier"])}（难度 {c["dc"]}）</div>'
            f'<div class="frx-check-roll">1d{c["die"]} = {c["roll"]}　{escape(c["attribute"])}修正 '
            f"{'+' if modifier >= 0 else ''}{modifier}　总值 {c['total']}</div>"
            f'<div class="frx-check-result">{escape(c["outcome"])}：'
            f'{escape(c["consequence"])}</div>'
            f"{effects}</div>"
        )
    if receipt.get("kind") == "resolve_attack" and receipt.get("ok"):
        return combat_card(receipt["attack"])
    if receipt.get("kind") == "breakthrough" and receipt.get("ok"):
        return breakthrough_card(receipt["breakthrough"], receipt.get("time") or {})
    if receipt.get("kind") in {
        "use_item",
        "claim_item",
        "use_skill",
        "equip_item",
        "unequip_item",
        "update_quest",
        "resolve_attack",
        "rest",
        "trade_item",
        "cultivate",
        "breakthrough",
        "chapter_reward",
        "world_rule",
        "purse",
    }:
        state = "ok" if receipt.get("ok") else "refused"
        label = {
            "use_skill": "施展",
            "equip_item": "装备",
            "unequip_item": "装备",
            "update_quest": "任务",
            "resolve_attack": "交锋",
            "rest": "休整",
            "trade_item": "交易",
            "cultivate": "机缘" if receipt.get("mode") == "机缘" else "修炼",
            "breakthrough": "突破",
            "chapter_reward": "主线奖励",
            "world_rule": "天道",
            "purse": "钱袋",
        }.get(receipt.get("kind"), "结算")
        summary = escape(receipt.get("summary", ""))
        return (
            f'<div class="frx-receipt-card" data-state="{state}">'
            f'<span class="frx-receipt-label">{label}</span>{summary}</div>'
        )
    return ""


def breakthrough_card(check, time):
    """A breakthrough shows its roll like a check, then what changed."""
    escape = _html.escape
    mods = "　".join(
        f"{escape(a['stat'])}修正 {'+' if a['modifier'] >= 0 else ''}{a['modifier']}"
        for a in check.get("attributes", [])
    )
    if check.get("aidBonus"):
        aids = "、".join(f"{a['name']}×{a['count']}" for a in check.get("aids", []))
        mods += f"　{escape(aids)} +{check['aidBonus']}"
    # the rest of the die's terms by name (the life's gate: 灵地, 护法, 心结 …), else as one sum
    terms = [t for t in check.get("terms") or [] if isinstance(t, dict) and t.get("label")]
    if terms:
        mods += "".join(f"　{escape(str(t['label']))} {int(t['value']):+d}" for t in terms)
    elif check.get("odds"):
        mods += f"　其余 {int(check['odds']):+d}"
    effects = []
    if check["realm"]["before"] != check["realm"]["after"]:
        effects.append(f"境界 {check['realm']['before']} → {check['realm']['after']}")
    if check.get("topUp"):
        effects.append(f"冲关前运功补足最后{check['topUp']['gain']}点修为")
    effects.append(f"修为 {check['progress']['before']} → {check['progress']['after']}")
    if check.get("lifespan"):
        before = check["lifespan"]["before"]
        before = "未注明" if before is None else before
        effects.append(f"寿元 {before} → {check['lifespan']['after']}")
    if check.get("growth"):
        effects.append(
            "属性 " + "、".join(f"{g['stat']}+{g['after'] - g['before']}" for g in check["growth"])
        )
    if check.get("hp"):
        hp = check["hp"]
        effects.append(f"血量 {hp['before']} → {hp['after']} / {hp['max']}")
    if check.get("cooldownUntil"):
        effects.append(f"{check['cooldownUntil']}之前不能再冲关")
    if time.get("before"):
        span = f"{check['days']}日" + ("余" if check.get("topUp") else "")
        effects.append(f"耗时{span}，时间 {time['before']} → {time['after']}")
    rows = "".join(f'<div class="frx-check-effect">{escape(str(e))}</div>' for e in effects)
    outcome = escape(check["outcome"])
    title = f"突破 · {escape(check['from'])} → {escape(check['to'])} · {escape(check['tier'])}"
    roll = f"1d{check['die']} = {check['roll']}　{mods}　总值 {check['total']}"
    return (
        f'<div class="frx-check-card" data-kind="breakthrough" data-outcome="{outcome}">'
        f'<div class="frx-check-title">{title}（难度 {check["dc"]}）</div>'
        f'<div class="frx-check-roll">{roll}</div>'
        f'<div class="frx-check-result">{outcome}：{escape(check["consequence"])}</div>'
        f"{rows}</div>"
    )


def combat_card(attack):
    escape = _html.escape
    names = {
        attack["attacker"]["id"]: attack["attacker"]["name"],
        attack["target"]["id"]: attack["target"]["name"],
    }
    notes = []
    for side in ("target", "attacker"):
        if attack[side].get("registered"):
            notes.append(
                f"新对手 {attack[side]['name']}（{attack[side]['id']} · {attack[side]['realm']}）"
            )
    if attack.get("skill"):
        paid = "，".join(f"{p['stat']} {p['before']}→{p['after']}" for p in attack.get("paid", []))
        notes.append(f"施展「{attack['skill']['name']}」" + (f"（{paid}）" if paid else ""))
    elif attack.get("paid"):
        notes.append(
            "催动法术（"
            + "，".join(f"{p['stat']} {p['before']}→{p['after']}" for p in attack["paid"])
            + "）"
        )
    lines = []
    for s in attack["strikes"]:
        mods = f"身法{s['agility']:+d} 境界{s['realm']:+d}" + (
            f" 偷袭{s['ambush']:+d}" if s.get("ambush") else ""
        )
        hp = s["hp"]
        result = (
            f"{'暴击' if s['critical'] else '命中'} · 伤害 {s['damage']} · "
            f"{escape(names[s['at']])}血量 {hp['before']} → {hp['after']} / {hp['max']}"
            + ("（重伤倒地）" if s.get("defeated") else "")
            if s["hit"]
            else "未命中"
        )
        roll = f"1d{s['die']} = {s['roll']}　{mods}　总值 {s['total']} / {s['dc']}"
        lines.append(
            f'<div class="frx-combat-strike" data-hit="{str(s["hit"]).lower()}">'
            f"{escape(names[s['by']])}出手　{roll} → {result}</div>"
        )
    note = "".join(f'<div class="frx-combat-note">{escape(n)}</div>' for n in notes)
    title = f"交锋 · {escape(attack['attacker']['name'])} → {escape(attack['target']['name'])}"
    body = "".join(lines)
    return (
        f'<div class="frx-combat-card"><div class="frx-combat-title">{title}</div>'
        f"{note}{body}</div>"
    )


def split_reply(raw):
    story = reply_story(raw)
    commands = re.search(r"<upstore>([\s\S]*?)</upstore>", raw, re.I)
    branches = re.search(r"<branches>[\s\S]*?</branches>", raw, re.I)
    return story, (commands[1].strip() if commands else ""), (branches[0] if branches else "")


def synthesize(story, receipts, commands, branches):
    cards = "".join(receipt_card(r) for r in receipts if not r.get("readOnly"))
    trusted = [r["commands"] for r in receipts if r.get("ok") and r.get("commands")]
    block = "\n".join([*trusted, commands] if commands else trusted)
    return f"<content>{cards}{story}</content>\n<upstore>\n{block}\n</upstore>\n{branches}".rstrip()


def tool_message(receipt):
    out = {"ok": bool(receipt.get("ok")), "结果": receipt.get("summary", "")}
    if receipt.get("reason"):
        out["原因"] = receipt["reason"]
    if receipt.get("kind") == "lookup_inventory":
        out["道具"] = receipt.get("items", [])
    if receipt.get("check"):
        c = receipt["check"]
        out["检定"] = {
            k: c[k] for k in ("roll", "modifier", "total", "dc", "outcome", "consequence")
        }
    if receipt.get("kind") == "recall_memory":
        out["记忆"] = receipt.get("memories", [])
    if receipt.get("attack"):
        attack = receipt["attack"]
        out["交锋"] = {
            "出手者": attack["attacker"],
            "目标": attack["target"],
            "出手": [
                {
                    k: s.get(k)
                    for k in (
                        "by",
                        "at",
                        "roll",
                        "total",
                        "dc",
                        "hit",
                        "critical",
                        "damage",
                        "hp",
                        "defeated",
                    )
                }
                for s in attack["strikes"]
            ],
        }
    if receipt.get("kind") == "update_quest" and receipt.get("ok"):
        out["任务"] = {**receipt["quest"], "奖励": receipt.get("rewards", [])}
    if receipt.get("cultivation") and receipt.get("ok"):
        c = receipt["cultivation"]
        out["修为"] = {
            "境界": [c["before"]["realm"], c["after"]["realm"]],
            "修为进度": [c["before"]["progress"], c["after"]["progress"]],
            "晋升": c.get("steps", []),
            "到瓶颈": c.get("bottleneck", False),
        }
        if receipt.get("fortune"):
            out["修为"]["机缘"] = receipt["fortune"]
    if receipt.get("breakthrough") and receipt.get("ok"):
        b = receipt["breakthrough"]
        out["突破"] = {
            k: b.get(k)
            for k in ("roll", "total", "dc", "outcome", "consequence", "realm", "progress",
                      "lifespan", "hp", "cooldownUntil")
        }
    if receipt.get("time") and receipt.get("ok"):
        out["时间"] = [receipt["time"]["before"], receipt["time"]["after"]]
    return json.dumps(out, ensure_ascii=False)


def event(data):
    return "data: " + json.dumps({"frx": data}, ensure_ascii=False) + "\n\n"


async def close_stream(stream):
    close = getattr(stream, "aclose", None) or getattr(stream, "close", None)
    if close:
        result = close()
        if _inspect.isawaitable(result):
            await result


def problem_text(item):
    """Settlement errors are strings or the card's {title, details} parse errors."""
    if isinstance(item, dict):
        return "：".join(str(item[k]) for k in ("title", "details") if item.get(k))
    return str(item)


REWRITE = (
    "上一版回复未通过引擎结算：{problems}。请重写完整回复，仍使用<content>、<upstore>、"
    "<branches>三段格式。正文必须与【引擎回执】一致；upstore只写结算之外的变化，不得改动"
    "回执结算过的道具数量、装备、法力、血量、技能熟练度、任务状态与灵石，检定未成功时不能习得技能。"
)


REWRITE_COMMANDS = (
    "上一版回复的状态指令未通过引擎结算：{problems}。正文已经展示给玩家，保持不变。"
    "请只输出修正后的完整<upstore>……</upstore>块，不要输出正文和分支。upstore只写结算之外的变化，"
    "不得改动回执结算过的道具数量、装备、法力、血量、技能熟练度、任务状态与灵石。"
)


def splice_commands(raw, repair):
    """Put a repaired state block into the reply, keeping its story and branches."""
    block = re.search(r"<upstore>[\s\S]*?</upstore>", repair or "", re.I)
    if not block:
        return None
    if re.search(r"<upstore>[\s\S]*?</upstore>", raw, re.I):
        return re.sub(
            r"<upstore>[\s\S]*?</upstore>", lambda _: block.group(0), raw, count=1, flags=re.I
        )
    if "</content>" in raw:
        return raw.replace("</content>", "</content>\n" + block.group(0), 1)
    return raw + "\n" + block.group(0)


def strip_cards(story):
    """The story without the receipt cards a synthesized reply puts in front of it."""
    text = story.lstrip()
    while text.startswith('<div class="frx-'):
        depth, index = 0, 0
        for match in re.finditer(r"<div\b|</div>", text):
            depth += 1 if match.group(0) == "<div" else -1
            if depth == 0:
                index = match.end()
                break
        if not index:
            break
        text = text[index:].lstrip()
    return text


async def complete_repair(complete, config, messages, *, max_tokens, stream=False):
    """Collect a repair before applying it; streaming avoids a proxy buffering the whole reply."""
    kwargs = dict(max_tokens=max_tokens, temperature=0.4, timeout=180)
    if not stream:
        return await complete(config, messages, **kwargs)
    upstream = await complete(config, messages, stream=True,
                              stream_options={"include_usage": True}, **kwargs)
    parts, size, usage, finish = [], 0, None, None
    try:
        async for chunk in upstream:
            usage = getattr(chunk, "usage", None) or usage
            for choice in chunk.choices:
                finish = getattr(choice, "finish_reason", None) or finish
                text = getattr(choice.delta, "content", None) or ""
                size += len(text)
                if size > 50000:
                    raise ModelFailure("修复回复超过长度上限，状态未应用")
                parts.append(text)
    finally:
        await close_stream(upstream)
    if finish not in ("stop", "length"):
        raise ModelFailure("修复回复未正常结束，状态未应用")
    return SimpleNamespace(usage=usage, choices=[SimpleNamespace(
        finish_reason=finish, message=SimpleNamespace(content="".join(parts)))])


class PilotTurn:
    """One engine-settled main turn: receipts, bounded tool rounds, story, checks."""

    def __init__(
        self,
        *,
        complete,
        config,
        messages,
        plan,
        archive,
        seed,
        sse,
        settle,
        metrics,
        recall=None,
        low_effort_tools=False,
        plot=None,
    ):
        self.complete = complete
        self.config = config
        self.messages = messages
        self.plan = plan
        self.archive = archive
        self.seed = seed
        self.sse = sse
        self.settle = settle
        self.metrics = metrics
        self.recall = recall
        self.low_effort_tools = low_effort_tools
        # The storyline a life save's tools run under (life_turns.storyline): move_place's journey
        # stops on its chapter's day as a verb's stretch does. None for a novel save's turn.
        self.plot = plot
        self.receipts = list(plan.get("receipts") or [])
        self.lookups = []
        self.tools = list(plan.get("tools") or [])
        self.upstream = None
        self.final = ""
        self.first_reply = ""

    async def model_round(self, messages, offer):
        kwargs = {}
        offer = [name for name in offer if name in TOOL_SPECS]
        if offer:
            kwargs["tools"] = [TOOL_SPECS[name] for name in offer]
            required = self.plan.get("mustTool") and not self.metrics.tool_rounds
            kwargs["tool_choice"] = "required" if required else "auto"
            if self.low_effort_tools and required:
                # A forced tool call only decides which tool to use. When tools are optional the
                # model may write the story in this same call, so it keeps the default effort.
                kwargs["reasoning_effort"] = "low"
        self.metrics.calls += 1
        self.upstream = await self.complete(
            self.config,
            messages,
            stream=True,
            stream_options={"include_usage": True},
            max_tokens=12000,
            temperature=0.8,
            timeout=180,
            **kwargs,
        )

    async def open_round(self, messages, offer):
        await self.model_round(messages, offer)
        stream = self.upstream.__aiter__()
        try:
            return stream, await stream.__anext__()
        except StopAsyncIteration:
            return stream, None

    async def run(self):
        yield "data: " + json.dumps({"frx": {"seed": self.seed}}) + "\n\n"
        early = [receipt_card(r) for r in self.receipts]
        if any(early):
            yield event({"cards": [card for card in early if card]})
        messages = list(self.messages)
        raw = ""
        round_index, empty_retried = 0, False
        life = self.plan.get("life") is not None
        truncated = False
        while round_index <= MAX_TOOL_ROUNDS:
            offer = self.tools if round_index < MAX_TOOL_ROUNDS else []
            call_started = time.monotonic()
            first = None
            for attempt in range(2):
                try:
                    # The budget covers opening the request too, since a provider can hold the
                    # headers. Only the first attempt has it: a slow but working provider still
                    # answers the retry, within the whole turn's limit. A forced tool call is a
                    # short decision; an optional one may be the story itself.
                    forced = offer and self.plan.get("mustTool") and not self.metrics.tool_rounds
                    budget = TOOL_FIRST_CHUNK_SECONDS if forced else STORY_FIRST_CHUNK_SECONDS
                    stream, first = await asyncio.wait_for(
                        self.open_round(messages, offer), budget if not attempt else None
                    )
                    break
                except TimeoutError:
                    if self.upstream:
                        await close_stream(self.upstream)
                    self.upstream = None
                    self.metrics.stalls += 1
                    if attempt:
                        raise ModelFailure("模型响应超时，请稍后重试。") from None
                except ModelFailure as error:
                    # A provider error before any output gets one fresh attempt.
                    if attempt or not getattr(error, "retryable", False):
                        raise
                    self.metrics.retries += 1

            async def chunks():
                if first is not None:
                    yield first
                async for item in stream:
                    yield item

            story_filter, text, calls, usage, shown = StoryFilter(), "", {}, None, False
            async for chunk in chunks():
                usage = getattr(chunk, "usage", None) or usage
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                if getattr(choice, "finish_reason", None) == "length":
                    if not life:
                        raise ModelFailure("模型回复被截断，状态未应用，请缩小本回合行动范围。")
                    truncated = True
                delta = choice.delta
                if getattr(delta, "content", None):
                    text += delta.content
                    if len(text) > 50000:
                        raise ModelFailure("回复超过长度上限")
                    for visible in story_filter.parts(delta.content):
                        if visible is None:
                            # The story starts over in a <content> block after words outside it.
                            yield event({"reset": True})
                            continue
                        self.metrics.first_token()
                        shown = True
                        yield self.sse(visible)
                for call in getattr(delta, "tool_calls", None) or []:
                    slot = calls.setdefault(call.index, {"id": None, "name": "", "arguments": ""})
                    slot["id"] = call.id or slot["id"]
                    function = getattr(call, "function", None)
                    if function and function.name:
                        slot["name"] += function.name
                    if function and function.arguments:
                        slot["arguments"] += function.arguments
            self.metrics.add_usage(usage)
            self.metrics.call_ms.append(round((time.monotonic() - call_started) * 1000))
            await close_stream(self.upstream)
            self.upstream = None
            self.final = text
            if not (calls and offer):
                if not finished(text) and not empty_retried and (not life or not text.strip()):
                    # A reply without a story (empty, or only an empty <content></content> and
                    # state commands) or cut off inside a block gets one fresh attempt; what it
                    # showed is taken back.
                    empty_retried = True
                    self.metrics.empty_retries += 1
                    if shown:
                        yield event({"reset": True})
                    continue
                raw = text
                break
            if shown:
                yield event({"reset": True})
            self.metrics.tool_rounds += 1
            ordered = [
                {**calls[i], "id": calls[i]["id"] or f"call_{round_index}_{i}"}
                for i in sorted(calls)
            ]
            messages.append(
                {
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for c in ordered
                    ],
                }
            )
            engine_calls = [c for c in ordered if c["name"] != "recall_memory"]
            outcome = (
                await run_engine(
                    {
                        "mode": "tools",
                        "archive": self.archive,
                        "receipts": self.receipts,
                        "calls": [
                            {"id": c["id"], "name": c["name"], "arguments": c["arguments"]}
                            for c in engine_calls
                        ],
                        "seed": self.seed,
                        **({"plot": self.plot} if self.plot else {}),
                    }
                )
                if engine_calls
                else {"results": []}
            )
            by_id = {result["id"]: result for result in outcome.get("results", [])}
            results = []
            for c in ordered:
                if c["name"] == "recall_memory":
                    try:
                        args = json.loads(c["arguments"] or "{}")
                    except ValueError:
                        args = {}
                    receipt = (
                        await self.recall(args)
                        if self.recall
                        else {
                            "kind": "recall_memory",
                            "ok": False,
                            "readOnly": True,
                            "summary": "没有可用的记忆",
                        }
                    )
                    results.append({"id": c["id"], "receipt": receipt})
                else:
                    results.append(by_id[c["id"]])
            cards = []
            for result in results:
                receipt = result["receipt"]
                if not receipt.get("readOnly"):
                    self.receipts.append(receipt)
                    cards.append(receipt_card(receipt))
                else:
                    # Kept for audit: what a lookup or recall actually returned to the model.
                    self.lookups.append(
                        {
                            k: receipt.get(k)
                            for k in ("kind", "ok", "summary", "items", "memories", "args")
                            if k in receipt
                        }
                    )
                messages.append(
                    {"role": "tool", "tool_call_id": result["id"], "content": tool_message(receipt)}
                )
            if any(cards):
                yield event({"cards": [card for card in cards if card]})
            round_index += 1
        if not raw.strip():
            raise ModelFailure("模型返回了空回复")
        if not life and not has_words(reply_story(raw)):
            raise ModelFailure("模型的回复里没有正文")
        if not life and cut_short(raw):
            raise ModelFailure(CUT_SHORT)
        story, commands, branches = split_reply(raw)
        result = await self.settle(raw, story, commands)
        if truncated:
            result["lifeTruncated"] = True
            result.setdefault("pilot", {}).setdefault("protocol", []).append(
                "模型回复被截断，请重新输出完整正文、状态指令和行动卡")
        problems = self.problems(result)
        # Contradicting a receipt and a command the card cannot apply both get one rewrite.
        rewrite_reasons = problems + [problem_text(e) for e in result.get("errors") or []]
        first_reply = ""
        if rewrite_reasons:
            self.metrics.rewrites += 1
            first_reply = raw[:20000]
            self.first_reply = first_reply
            if ((result.get("pilot") or {}).get("mismatches")
                    or (result.get("pilot") or {}).get("protocol")):
                rewritten = await self.rewrite(raw, rewrite_reasons)
                # A rewrite without a story keeps the one the player read, problems and all.
                if has_words(reply_story(rewritten)):
                    raw, truncated = rewritten, False
            else:
                # Only the state block failed and the player has already read the story: keep it.
                repair = await self.rewrite(raw, rewrite_reasons, commands_only=True)
                raw = splice_commands(raw, repair) or raw
            story, commands, branches = split_reply(raw)
            result = await self.settle(raw, story, commands)
            if truncated:
                result["lifeTruncated"] = True
                result.setdefault("pilot", {}).setdefault("protocol", []).append(
                    "模型回复被截断，请重新输出完整正文、状态指令和行动卡")
            problems = self.problems(result)
        unresolved = []
        if rewrite_reasons and problems and not self.blocking(result):
            # The story checks read free text. After one rewrite a remaining doubt is kept for
            # review instead of holding the turn: the receipts have already settled the state.
            unresolved, problems = problems, []
        errors = list(result.get("errors") or []) + problems
        commands = result.get("modelCommands", commands)
        # Gear the story's own commands put on or took off: the engine's receipt for it.
        self.receipts += result.get("gearReceipts") or []
        self.final = synthesize(story, self.receipts, commands, branches)
        yield event({"final": self.final})
        # Quiet refusals count for the engine's numbering of the turn's receipts (and its dice)
        # while the turn runs; the turn keeps them only for audit, beside the lookups.
        quiet = [r for r in self.receipts if r.get("quiet")]
        result.update(
            errors=errors,
            receipts=[r for r in self.receipts if not r.get("quiet")],
            pilotPlan={k: self.plan.get(k) for k in ("reasons", "tools", "mustTool")},
            pilotProblems=problems,
            pilotUnresolved=unresolved,
            pilotRewriteReasons=rewrite_reasons,
            pilotFirstReply=first_reply,
            pilotLookups=self.lookups + [
                {k: r.get(k) for k in ("kind", "ok", "summary", "reason", "quiet")} for r in quiet
            ],
            pilotDropped=(result.get("pilot") or {}).get("dropped", []),
        )
        if problems:
            result["pilotPending"] = True
        self.settlement = result

    @staticmethod
    def problems(result):
        """Ownership violations, story mismatches and bookkeeping misses (stones the story moved
        but the commands did not book), plus missing life reply blocks and choices."""
        pilot = result.get("pilot") or {}
        return (
            list(pilot.get("ownership") or [])
            + list(pilot.get("mismatches") or [])
            + list(pilot.get("bookkeeping") or [])
            + list(pilot.get("protocol") or [])
        )

    @staticmethod
    def blocking(result):
        """What must not be committed: commands the card cannot apply and model commands that
        change what the engine settled, or an incomplete life reply. Story mismatches are
        checked by reading free text."""
        pilot = result.get("pilot") or {}
        return (list(result.get("errors") or []) + list(pilot.get("ownership") or [])
                + list(pilot.get("protocol") or []))

    async def rewrite(self, raw, problems, commands_only=False):
        """Regenerate the reply once from the fixed receipts, without tools: the whole reply,
        or only its state block when the story itself is fine."""
        messages = [dict(m) for m in self.messages]
        for message in messages:
            if message["role"] == "user":
                message["content"] = re.sub(
                    r"\n【引擎回执[\s\S]*$", "", message["content"]
                ) + receipts_text(self.receipts)
                break
        prompt = REWRITE_COMMANDS if commands_only else REWRITE
        if not commands_only and self.plan.get("life") is not None:
            from .life_prompt import cards_rule

            prompt = ("上一版回复不完整或未通过结算：{problems}。请重写完整正文、状态指令和行动卡，"
                      "保持玩家行动及引擎回执的结果，不要重复执行行动。\n"
                      + cards_rule())
        messages += [
            {"role": "assistant", "content": raw},
            {"role": "user", "content": prompt.format(problems="；".join(problems))},
        ]
        if commands_only and self.plan.get("life") is not None:
            from .life_prompt import command_repair_messages

            messages = command_repair_messages(
                self.archive, self.receipts, raw, problems,
                prompt.format(problems="；".join(problems)),
            )
        self.metrics.calls += 1
        started = time.monotonic()
        response = await complete_repair(
            self.complete,
            self.config,
            messages,
            max_tokens=6000 if commands_only else 12000,
            stream=self.plan.get("life") is not None,
        )
        self.metrics.call_ms.append(round((time.monotonic() - started) * 1000))
        self.metrics.add_usage(getattr(response, "usage", None))
        if getattr(response.choices[0], "finish_reason", None) == "length":
            raise ModelFailure("重写回复被截断，状态未应用。")
        return response.choices[0].message.content or ""
