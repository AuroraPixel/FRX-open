"""Local test double for the OpenAI-compatible wire protocol, never used by the app."""

import argparse
import json
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread


class Provider(ThreadingHTTPServer):
    daemon_threads = True
    failures = False
    failure_status = 401
    failure_message = "test provider rejected request"
    invalid_extraction = False
    calls = 0
    # Card mode answers the original card's own requests (turns, archiving, summaries, the daily
    # paper, world evolution) with fixed replies built from the request, for parity recordings.
    card = False
    # Seconds between the frames of a card-mode stream (tests stretch it to stop a turn midway).
    delay = 0.004

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tool_requests = []
        # The scene descriptions asked for (frx.play_places.ask_model), and the answer given.
        self.scene_requests = []
        # The beats of the cultivation life asked for (their prompt has the action cards' rule),
        # and the annals lines asked to be written out (写一段).
        self.life_requests = []
        self.elaborate_requests = []
        self.scene_answer = {"setting": "indoor", "terrain": "none", "structure": "study",
                             "features": ["books"], "scale": "narrow", "mood": "calm"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        """GET /calls: how many requests the double has answered, all of them and the beats and
        the annals lines asked to be written out among them (the live end-to-end scripts count
        the model's calls with it)."""
        if self.path != "/calls":
            self.send_response(404)
            self.end_headers()
            return
        self.send_json({"calls": self.server.calls, "life": len(self.server.life_requests),
                        "elaborate": len(self.server.elaborate_requests)})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.calls += 1
        if self.server.card and self.path == "/v1/embeddings":
            texts = payload["input"] if isinstance(payload["input"], list) else [payload["input"]]
            self.send_json({"object": "list", "model": payload["model"], "data": [
                {"object": "embedding", "index": index, "embedding": card_embedding(text)}
                for index, text in enumerate(texts)
            ]})
            return
        if self.path != "/v1/chat/completions" or self.server.failures:
            self.send_response(self.server.failure_status)
            self.end_headers()
            error = json.dumps({"error": {"message": self.server.failure_message}}).encode()
            self.wfile.write(error)
            return
        if self.server.card and SCENE_ASK in str(payload["messages"][0].get("content")):
            self.server.scene_requests.append(payload)
            self.send_json(completion(payload, json.dumps(self.server.scene_answer,
                                                          ensure_ascii=False)))
            return
        if self.server.card:
            if any(LIFE_RULE in str(m.get("content") or "") for m in payload["messages"]):
                self.server.life_requests.append(payload)
            if any(ELABORATE in str(m.get("content") or "") for m in payload["messages"]):
                self.server.elaborate_requests.append(payload)
            reply = card_reply(payload)
            if isinstance(reply, list):
                self.stream_frames(payload, [], reply)
            elif payload.get("stream"):
                self.stream_frames(payload, [reply[i : i + 7] for i in range(0, len(reply), 7)])
            else:
                self.send_json(completion(payload, reply))
            return
        if payload.get("tools") or any(m.get("role") == "tool" for m in payload["messages"]):
            self.card_tools(payload)
            return
        if payload.get("stream"):
            user = json.loads(payload["messages"][-1]["content"])
            action = user["action"]
            narrative = "你沿着青石板路走进坊市。晨雾还未散尽，药铺的灯火已经亮起。\n\n"
            if "买" in action:
                narrative += (
                    "掌柜按照约定收下八枚灵石，将一枚回气丹递到你手中。"
                    "你将丹药收好，向他问起附近的山路。"
                )
            elif "打坐" in action or "休息" in action:
                narrative += "你寻了一处僻静的角落，调匀呼吸。片刻后，纷乱的心绪逐渐平静。"
            else:
                narrative += (
                    "几位散修正在谈论附近山路的近况。掌柜放下手中的药秤，耐心听你说完，才缓缓作答。"
                )
            pieces = [narrative[i : i + 8] for i in range(0, len(narrative), 8)]
            chunks = []
            for piece in pieces:
                chunk = dict(
                    id="chatcmpl-test",
                    object="chat.completion.chunk",
                    created=1,
                    model=payload["model"],
                    choices=[
                        dict(
                            index=0,
                            delta={"content": piece},
                            finish_reason=None,
                        )
                    ],
                )
                chunks.append(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode())
            chunks.append(
                b'data: {"id":"chatcmpl-test","object":"chat.completion.chunk",'
                b'"created":1,"model":"test","choices":[{"index":0,"delta":{},'
                b'"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Content-Length", str(sum(map(len, chunks))))
            self.end_headers()
            try:
                for index, chunk in enumerate(chunks):
                    # Deliberately split inside UTF-8 and JSON/SSE line boundaries.
                    self.wfile.write(chunk[:17])
                    self.wfile.flush()
                    self.wfile.write(chunk[17:])
                    self.wfile.flush()
                    time.sleep(5 if "等待" in action and index == 0 else 0.025)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            extraction = dict(
                location="潮岚道 · 太南谷坊市",
                facts=["药铺掌柜熟悉附近的山路。"],
                branches=["买一枚回气丹", "找一处安静地方打坐", "向掌柜询问附近山路"],
            )
            if self.server.invalid_extraction:
                extraction["player"] = {"stones": 99999}
            data = json.dumps(
                dict(
                    id="chatcmpl-test",
                    object="chat.completion",
                    created=1,
                    model=payload["model"],
                    choices=[
                        dict(
                            index=0,
                            message=dict(
                                role="assistant", content=json.dumps(extraction, ensure_ascii=False)
                            ),
                            finish_reason="stop",
                        )
                    ],
                    usage=dict(prompt_tokens=100, completion_tokens=30, total_tokens=130),
                ),
                ensure_ascii=False,
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)


    def send_json(self, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def stream_frames(self, payload, pieces, calls=()):
        """A streamed reply: text pieces, or tool calls when `calls` is given."""
        frames = []

        def frame(delta, finish=None):
            body = dict(id="chatcmpl-card", object="chat.completion.chunk", created=1,
                        model=payload["model"],
                        choices=[dict(index=0, delta=delta, finish_reason=finish)])
            frames.append(("data: " + json.dumps(body, ensure_ascii=False) + "\n\n").encode())

        for piece in pieces:
            frame({"content": piece})
        for index, (name, arguments) in enumerate(calls):
            frame({"tool_calls": [{"index": index, "id": f"call_{index}", "type": "function",
                                   "function": {"name": name, "arguments": arguments}}]})
        frame({}, "tool_calls" if calls else "stop")
        usage = dict(id="chatcmpl-card", object="chat.completion.chunk", created=1,
                     model=payload["model"], choices=[],
                     usage=dict(prompt_tokens=120, completion_tokens=30, total_tokens=150))
        frames.append(("data: " + json.dumps(usage) + "\n\ndata: [DONE]\n\n").encode())
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Content-Length", str(sum(map(len, frames))))
        self.end_headers()
        try:
            for chunk in frames:
                self.wfile.write(chunk[:11])
                self.wfile.flush()
                self.wfile.write(chunk[11:])
                self.wfile.flush()
                time.sleep(self.server.delay)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def card_tools(self, payload):
        """Card pilot turns: stream OpenAI tool calls, then a story after tool results."""
        self.server.tool_requests.append(payload)
        user = next(m["content"] for m in payload["messages"] if m["role"] == "user")
        answered = any(m.get("role") == "tool" for m in payload["messages"])
        frames = []

        def frame(delta, finish=None):
            body = dict(id="chatcmpl-tools", object="chat.completion.chunk", created=1,
                        model=payload["model"],
                        choices=[dict(index=0, delta=delta, finish_reason=finish)])
            frames.append(("data: " + json.dumps(body, ensure_ascii=False) + "\n\n").encode())

        if payload.get("tools") and not answered:
            if "错参" in user:
                calls = [("use_item", '{"item_id": "I1", "quantity": ')]
            else:
                calls = [
                    ("claim_item", json.dumps({"source_id": "C1", "item_id": "I9", "quantity": 1})),
                    ("use_item", json.dumps({"item_id": "I1", "quantity": 1})),
                ]
            for index, (name, arguments) in enumerate(calls):
                frame({"tool_calls": [{"index": index, "id": f"call_{index}", "type": "function",
                                       "function": {"name": name, "arguments": ""}}]})
                for i in range(0, len(arguments), 9):
                    frame({"tool_calls": [{"index": index,
                                           "function": {"arguments": arguments[i:i + 9]}}]})
            frame({}, "tool_calls")
        else:
            story = ("<content>陈老汉把补气丸塞进你手里，你当即服下，法力渐渐充盈。</content>\n"
                     '<upstore>add("TIME_LOCATION_ROW",'
                     '{"0":"0001年 01月 01日 08:15/潮岚道/白苇集（药圃）980,520"})'
                     "</upstore>\n<branches>[A.道谢][B.继续拔草]</branches>")
            for i in range(0, len(story), 6):
                frame({"content": story[i:i + 6]})
            frame({}, "stop")
        usage = dict(id="chatcmpl-tools", object="chat.completion.chunk", created=1,
                     model=payload["model"], choices=[],
                     usage=dict(prompt_tokens=120, completion_tokens=30, total_tokens=150))
        frames.append(("data: " + json.dumps(usage) + "\n\ndata: [DONE]\n\n").encode())
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Content-Length", str(sum(map(len, frames))))
        self.end_headers()
        for chunk in frames:
            # Split inside UTF-8 sequences and SSE lines, as the narrative mode does.
            self.wfile.write(chunk[:13])
            self.wfile.flush()
            self.wfile.write(chunk[13:])
            self.wfile.flush()


# ---------------------------------------------------------------- card mode

NARRATOR = "你是《云汀修行录》文字RPG的叙事者"
PEDLAR = "C9"
SCENES = (
    "晨雾未散，石阶上还凝着露水。",
    "日头正高，远处传来几声鸡鸣。",
    "山风穿过林梢，吹得檐下铜铃轻响。",
    "暮色渐沉，几户人家已点起了灯。",
    "细雨方歇，青石路面泛着微光。",
)
LINES = (
    "这条路我走了几十年，前头不太平，你多加小心。",
    "听说近来山里来了几个外乡人，行踪古怪。",
    "天色不早了，办完事早些回来。",
    "这事急不得，慢慢来。",
)


def card_embedding(text, size=16):
    """A small fixed vector from the text's characters, the same on every call."""
    vector = [0.0] * size
    for index, char in enumerate(str(text)):
        vector[(ord(char) + index) % size] += 1.0
    norm = sum(v * v for v in vector) ** 0.5 or 1.0
    return [round(v / norm, 6) for v in vector]


def completion(payload, text):
    return dict(
        id="chatcmpl-card", object="chat.completion", created=1, model=payload["model"],
        choices=[dict(index=0, message=dict(role="assistant", content=text),
                      finish_reason="stop")],
        usage=dict(prompt_tokens=100, completion_tokens=30, total_tokens=130),
    )


def later(text, minutes=60):
    """The time row an hour on (thirty-day months), the place unchanged."""
    import re

    match = re.match(r"(\d+)年 (\d+)月 (\d+)日 (\d+):(\d+)([\s\S]*)", text)
    if not match:
        return text
    year, month, day, hour, minute = (int(match[i]) for i in range(1, 6))
    total = (((year * 12 + month - 1) * 30 + day - 1) * 24 + hour) * 60 + minute + minutes
    minute, total = total % 60, total // 60
    hour, total = total % 24, total // 24
    day, total = total % 30 + 1, total // 30
    month, year = total % 12 + 1, total // 12
    return f"{year:04d}年 {month:02d}月 {day:02d}日 {hour:02d}:{minute:02d}{match[6]}"


# How the scene description's prompt starts (frx.play_places.model_messages).
SCENE_ASK = "舞台美术判断主角此刻所在之处的样子"


def card_turn(messages):
    """A main turn's reply in the card's format, from the player's words and the state the
    prompt carries: a scene, one line of dialogue from someone present, the time an hour on,
    summaries and four options."""
    import re

    user = next(m["content"] for m in messages if m["role"] == "user")
    head, _, rest = user.partition("【可用实体ID与当前原始状态】\n")
    state = json.loads(rest.split("\n", 1)[0]) if rest.strip() else {}
    said = head.rsplit("### 玩家输入：", 1)[-1]
    lines = [line[2:].strip() for line in said.splitlines() if line.startswith("> ")]
    action = (lines[-1] if lines else "").removeprefix("我") or "静立片刻，环顾四周"
    rows = state.get("4") or []
    row = next((r for r in rows if isinstance(r, dict) and r.get("id") == "TIME_LOCATION_ROW"),
               rows[0] if rows and isinstance(rows[0], dict) else {})
    now = str(row.get("0", ""))
    present = state.get("0") or {}
    people = [r for key, r in sorted(present.items()) if key.startswith("C") and key != PEDLAR]
    speaker = str(people[0].get("1", "")).split("|")[0] if people else "过路的老人"
    seed = sum(map(ord, action + now))
    story = (
        f"{SCENES[seed % len(SCENES)]}你{action}。\n\n"
        f"{speaker}：“{LINES[seed % len(LINES)]}”\n\n"
        "你点了点头，把这番话**记在心里**。"
    )
    commands = []
    if now:
        # 「前往某处」 takes the player there: the spot of the time row is the place named.
        going = re.search(r"前往([^，。,.!！?？\s]{1,20})", action)
        row_text = arrive(later(now), going[1]) if going else later(now)
        commands.append('add("TIME_LOCATION_ROW",' + json.dumps({"0": row_text},
                                                                ensure_ascii=False) + ")")
    # A pedlar comes by now and then and is gone the turn after, so off-screen people with
    # biographies turn up for world evolution.
    if PEDLAR in present:
        story += "\n\n货郎挑起担子，摇着拨浪鼓走远了。"
        commands.append(f'de("{PEDLAR}")')
    elif seed % 3 == 0:
        story += "\n\n一个挑着货担的货郎在路边歇脚，冲你笑了笑。"
        row = {"0": PEDLAR, "1": "过路的货郎|男", "2": "凡人|货郎", "3": "健谈",
               "4": "一切正常", "16": "坐在路边歇脚|粗布短褂||精瘦|笑容满面"}
        commands.append("set(" + json.dumps(row, ensure_ascii=False) + ")")
    if "乱写指令" in action:
        # A command the engine refuses (the player cannot be removed): the turn waits.
        commands.append('de("B1")')
    commands.append("addSmallSummary(" + json.dumps(f"{now.split('/')[0]}，{action}",
                                                    ensure_ascii=False) + ")")
    commands.append("addLargeSummary(" + json.dumps(action, ensure_ascii=False) + ")")
    return (f"<content>{story}</content>\n<upstore>{chr(10).join(commands)}</upstore>\n"
            "<branches>[A.继续打听消息][B.四处走走看看][C.回去歇息][D.去山里看看]</branches>")


# A beat of the cultivation life asks for action cards (content/life/prompt.json's rule); 写一段
# asks for one annals line written out (its elaborate rule); the eulogies after a death of old
# age (frx.play_legacy) ask for one line from each old acquaintance.
LIFE_RULE = "改用<actions></actions>交回"
# A small matter's scene opening (content/life/prompt.json situation.light) and its 回目.
LIGHT_RULE = "这是一件小事，一拍就了"
LIGHT_TITLE = "<title>邻家夜半起纷争　灯下好言劝罢休</title>"
ELABORATE = "把下面这一行年谱写成一段正文"
EULOGY = "为一位坐化的修士写几句故人的评说"


def eulogy_reply(text):
    """The eulogies: one line from each 【故人】 the request names, as the JSON array it asks."""
    import re

    said = [{"id": who, "text": f"{name}叹道：他这一辈子，走得不容易。"}
            for who, name in re.findall(r"【故人】(\S+) ([^（\s]+)", text)]
    return json.dumps(said, ensure_ascii=False)


def elaborate_reply(messages):
    """写一段: the annals line written out as a passage, in the <content> the rule asks for."""
    user = next(m["content"] for m in messages if m["role"] == "user")
    line = next((text for text in user.splitlines() if text.startswith("【年谱】")), "【年谱】")
    said = line.removeprefix("【年谱】").strip()
    return ("<content>" + said + "\n\n这些日子里你闭门不出，一呼一吸都慢了下来。窗外的日影移过又"
            "移回，灵气在经脉里一圈圈地走，你只觉身子一日比一日轻。</content>")


def proving_lead(payload, messages):
    """The model's prove_lead in a beat of the life when the player's words ask for it (查实F2):
    the tool round first; the story follows once the tool has answered."""
    import re

    user = next(m["content"] for m in messages if m["role"] == "user")
    said = user.partition("【可用实体ID与当前原始状态】")[0].rsplit("### 玩家输入：", 1)[-1]
    asked = re.search(r"查实(F\d+)", said)
    offered = {tool["function"]["name"] for tool in payload.get("tools") or []}
    if not asked or "prove_lead" not in offered:
        return None
    return [("prove_lead", json.dumps({"id": asked[1], "how": "细看之下，对上了"},
                                      ensure_ascii=False))]


def granting_chance(payload, messages):
    """The model's grant_chance in a beat of the life when the player's words say a legacy came
    (得了传承): the tool round first; the story follows once the tool has answered."""
    user = next(m["content"] for m in messages if m["role"] == "user")
    said = user.partition("【可用实体ID与当前原始状态】")[0].rsplit("### 玩家输入：", 1)[-1]
    offered = {tool["function"]["name"] for tool in payload.get("tools") or []}
    if "得了传承" not in said or "grant_chance" not in offered:
        return None
    return [("grant_chance", json.dumps({"reason": "古修洞府的石壁上留着一位前辈的结婴心得"},
                                        ensure_ascii=False))]


def moving_place(payload, messages):
    """The model's move_place in a beat of the life when the player's words ask for the journey
    (动身去白苇集, batch 7): the tool round first; the story follows once the tool has answered."""
    import re

    user = next(m["content"] for m in messages if m["role"] == "user")
    said = user.partition("【可用实体ID与当前原始状态】")[0].rsplit("### 玩家输入：", 1)[-1]
    words = " ".join(line[2:] for line in said.splitlines() if line.startswith("> "))
    asked = re.search(r"动身去([\u4e00-\u9fff]{2,6})$", words.strip())
    offered = {tool["function"]["name"] for tool in payload.get("tools") or []}
    if not asked or "move_place" not in offered:
        return None
    return [("move_place", json.dumps({"to": asked[1], "reason": "动身赶路"}, ensure_ascii=False))]


def life_turn(messages, text):
    """A beat of a scene in the cultivation life, from the novel's reply: the action cards in
    place of the branches; the scene's name when the beat opens one; <close> when the prompt
    says the beat must close, or the words ask for it (收场). The player's words can ask for a
    broken card block (坏卡: the branches stay, for the engine to sort), a beat that never closes
    (不收场), a time three days on (三日之后), a card the player cannot take (要施术), a 用物 card
    that says taking the thing (要服丹) or one that
    comes to blows with someone there (要动手) or with a snake the story never registers
    (要打蛇), or someone above the player stepping into the story with a talk aimed at them
    (来了个前辈), or a date the calendar does not write (写错日子), story threads left for later
    (留线头: life_threads) or one seen to (了结线头: the thread the prompt names first; 了结因果:
    the ledger's first open entry it lists), or a close that still hands back cards (收场带卡)."""
    import re

    reply = card_turn(messages)
    user = next(m["content"] for m in messages if m["role"] == "user")
    head, _, rest = user.partition("【可用实体ID与当前原始状态】\n")
    said = head.rsplit("### 玩家输入：", 1)[-1]
    words = " ".join(line[2:] for line in said.splitlines() if line.startswith("> "))
    state = json.loads(rest.split("\n", 1)[0]) if rest.strip() else {}
    if "三日之后" in words:
        row = r'(add\("TIME_LOCATION_ROW",\{"0": ")([^"]*)'
        reply = re.sub(row, lambda found: found[1] + later(found[2], 3 * 24 * 60 - 60), reply,
                       count=1)
    if any(m.get("role") == "tool" for m in messages) and "动身去" in words:
        # after the model's own journey (moving_place) the time row is its receipt's: the story
        # writes none, as the rule for move_place says
        reply = re.sub(r'add\("TIME_LOCATION_ROW",\{[^}]*\}\)\n?', "", reply)
    people = sorted(key for key in (state.get("0") or {}) if key.startswith("C") and key != PEDLAR)
    items = sorted(key for key, row in (state.get("1") or {}).items()
                   if isinstance(row, dict) and "消耗品" in str(row.get("2", "")))
    cards = [
        f"[交涉|请旅人引路去集市|{people[0] if people else ''}|中]",
        "[探查|验看山道车辙||中]",
        "[潜行|绕过路口去村南||难]",
        f"[用物|取出随身之物|{items[0]}]" if items else "[静观|等守路人离去再通行]",
    ]
    if "要施术" in words:
        # a skill the player does not have: the engine shows the card as 不够格
        cards[-1] = "[施术|以敛息术藏起修为|S99]"
    if "要服丹" in words and items:
        # a 用物 card whose words say taking the thing (服下…): the act uses it, once
        name = str(state["1"][items[0]].get("1") or "")
        cards[-1] = f"[用物|服下{name}定一定心神|{items[0]}]"
    if "要动手" in words:
        # a card that comes to blows with someone on the scene: the act opens a fight. With no
        # one there, a robber steps out of the story (his row is the reply's own command), and
        # the card is aimed at him: on the scene by the time the card is taken.
        if people:
            cards[2] = f"[强攻|拔剑刺向对方|{people[0]}]"
        else:
            robber = {"0": "C7", "1": "拦路的山贼|男", "2": "凡人|山贼", "3": "凶悍",
                      "4": "一切正常", "16": "横刀拦在路中|粗布短打||魁梧|满脸横肉"}
            reply = reply.replace("</upstore>", "\nset(" + json.dumps(robber, ensure_ascii=False)
                                  + ")</upstore>", 1)
            cards[2] = "[强攻|拔剑刺向山贼|C7]"
    if "要打蛇" in words:
        # a beast the story brings and never registers (batch 7): the 强攻 card names it, no id
        reply = reply.replace("<content>", "<content>崖上一条赤鳞毒蛇昂起头来，冲你吐着信子。", 1)
        cards[2] = "[强攻|一剑斩向崖上的毒蛇|赤鳞毒蛇]"
    if "要动手" in words or "要打蛇" in words:
        # 强攻 is this beat's one non-rolling choice; do not add a second one (用物).
        cards[-1] = "[脱身|退到山道另一侧||中]"
    if "写错日子" in words:
        # a date the calendar does not write: the server keeps it in the calendar's words
        reply = reply.replace("<content>", "<content>二月初十一，山风微凛。", 1)
    if "来了个前辈" in words:
        # someone a major realm above the player steps into the story (the reply's own command),
        # and the first card is a talk aimed at them that the model calls easy
        elder = {"0": "C8", "1": "过路的前辈|男", "2": "炼气五层|散修", "3": "温和",
                 "4": "一切正常", "16": "负手立在道旁|青布道袍||清瘦|目光沉静"}
        reply = reply.replace("</upstore>", "\nset(" + json.dumps(elder, ensure_ascii=False)
                              + ")</upstore>", 1)
        cards[0] = "[交涉|向前辈请教吐纳的诀窍|C8|易]"
    if "开场戏到这一拍收场" in text:
        # the opening scene's last beat: the first method comes into the bag (its own command)
        method = {"0": "I88", "1": "长春功", "2": "功法", "3": "一部粗浅的吐纳法门，炼气期可修。",
                  "4": "无", "5": "1"}
        reply = reply.replace("</upstore>", "\nset(" + json.dumps(method, ensure_ascii=False)
                              + ")</upstore>", 1)
    cards, reply = life_people(cards, reply, state, text)
    routes = {"交涉": "结盟", "探查": "求证", "潜行": "转移", "用物": "处置",
              "静观": "处置", "脱身": "转移", "强攻": "处置", "欺瞒": "处置", "施术": "修行"}
    # The mock offers another decision after a prior card has succeeded, like a valid model.
    for i, written in enumerate(cards):
        fields = written[1:-1].split("|")
        kind, title = fields[:2]
        intent = {"验看山道车辙": "查清车队离去的方向",
                  "取出随身之物": "用随身药物稳住气息"}.get(title, title)
        if f"本次选择的具体目的为「{intent}」" in text:
            fields, kind, intent = ["脱身", "沿西坡去驿亭会合", "", "中"], "脱身", "到西坡驿亭会合"
        fields += [""] * (5 - len(fields))
        cards[i] = "[" + "|".join([*fields, f"{routes[kind]}：{intent}"]) + "]"
    reply = life_foes(reply, state, text)
    reply = life_pedlars(reply, state)
    tail = ""
    if "<volume>卷末语</volume>" in text:
        # a gate passed closed the book's volume (item 38): the page's words
        tail += "<volume>这一卷，你从凡人走到了引气入体，山门外的路才刚开头。</volume>"
    if "这一拍开一场戏" in text:
        tail += "<scene>山道上的来客</scene>"
    if "留线头" in words:
        # story threads the beat leaves (batch 9): an answer someone waits for, and one tonight
        tail += life_threads(state)
    if "了结线头" in words:
        # the thread this scene took up (or the first open one) seen to: settled by its id
        named = re.search(r"线头(T\d+)「", text) or re.search(r"还没了结的线头：(T\d+) ", text)
        if named:
            fact = "你当面给了他明确的答复"
            reply = reply.replace("</content>", fact + "。</content>", 1)
            tail += f"<threads>\n[了结|{named[1]}|{fact}]\n</threads>"
    if "了结因果" in words:
        # the first open entry of the ledger the beat lists, kept: settled by its id
        entry = re.search(r"账本里的编号）：(Y\d+) ", text)
        if entry:
            tail += f"<threads>\n[了结|{entry[1]}]\n</threads>"
    closing = ("这一拍要收场" in text or "收场" in words) and "不收场" not in words
    if "坏卡" in words:
        tail += "<actions>\n乱写一气，没有一张像样的卡\n</actions>"
        return reply + "\n" + tail
    reply = re.sub(r"<branches>[\s\S]*?</branches>", "", reply).rstrip()
    if closing:
        weight = "大" if "大收场" in words else "中"
        # a 回目 when asked for one (item 38): a good one, or a bad one (坏回目)
        if "回目" in words:
            tail += ("<title>夜救残修，神机卫三搜</title>" if "坏回目" in words
                     else "<title>云水居夜救残修　神机卫三搜客房</title>")
        if "收场带卡" in words:
            # a close that still hands back cards (batch 9's close rule)
            tail = "<actions>\n" + "\n".join(cards) + "\n</actions>\n" + tail
        return reply + "\n" + tail + f"<close>{weight}</close>"
    if LIGHT_RULE in text:
        # a small matter's scene (batch 8): each card's two lines, the line for leaving and the
        # 回目, all in this one call
        lined = []
        for each in cards:
            lined += [each, "成：这件事办成了，对方连声道谢。", "败：没能办成，对方摇摇头走开了。"]
        lined.append("离：你没再理会这件事，转身走开了。")
        return (reply + "\n" + tail + "<actions>\n" + "\n".join(lined) + "\n</actions>\n"
                + LIGHT_TITLE)
    return reply + "\n" + tail + "<actions>\n" + "\n".join(cards) + "\n</actions>"


# ---------------------------------------------------------------- the life's people (item 50)

# What the mock does with the people of a life save, now and then and by the request's seed, so a
# long run reaches people, the ledger, heart knots and heirs (playtest-2, 交给别的路的 6): it meets
# someone when a scene opens (a row of a realm near the player's, MET), keeps at most KEEP of them
# on the scene besides the bonded, notes 恩 怨 债 诺 with one there and a knot after an unkind card
# (note_karma, note_knot), settles them later by the ids the beat lists, binds a 道侣 at 信赖 and,
# from 筑基 on, takes a 弟子 (YOUNG, a major realm below) by the relation column, as a story does.
# Only with LIFE_PEOPLE (the command line's --people, or a test that sets it): the other tests'
# replies stay as they were.
LIFE_PEOPLE = False
# One scene opening in LIFE_MEET meets someone (the command line's --meet; a long run that is to
# fill the people's book past its cap within the hour meets someone at every one).
LIFE_MEET = 3
MET, YOUNG = "游历散修", "求道少年"
KEEP = 2
SURNAMES = "沈林苏陆顾谢温秦叶宋"
GIVEN = {"男": "远川衡砚澈", "女": "婉青霜蘅宁"}
NATURES = ("沉稳", "爽朗", "多疑", "温和", "孤僻")
MAJORS = ("凡人", "炼气", "筑基", "结丹", "元婴", "化神")
STEPS = ("初期", "中期", "后期")
LAYERS = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三")
KARMA = {
    "恩": "你替{名}解了一回围",
    "怨": "你当众驳了{名}的面子",
    "债": "你向{名}借了些盘缠",
    "诺": "你答应替{名}寻一味灵草",
}
# an unkind card (欺瞒 or 强攻, or words that wrong someone) and the knot it leaves
UNKIND = {"欺瞒": "失信", "强攻": "滥杀"}
UNKIND_WORDS = (("丢下", "背弃同伴"), ("撇下", "背弃同伴"), ("抢", "夺人机缘"), ("夺", "夺人机缘"),
                ("袖手", "见死不救"))


def life_seed(state, text, salt):
    """A number of the request (its time row and its beat) and the use it is put to."""
    import re
    import zlib

    rows = state.get("4") or []
    row = next((r for r in rows if isinstance(r, dict) and r.get("id") == "TIME_LOCATION_ROW"), {})
    beat = re.search(r"【这一拍】[^\n]{0,40}", text)
    return zlib.crc32(f"{salt}|{row.get('0', '')}|{beat[0] if beat else ''}".encode())


def major_of(realm):
    """The major realm's index of a realm's words (炼气三层 → 1), 0 when it reads none."""
    return next((n for n, name in reversed(list(enumerate(MAJORS))) if name in str(realm)), 0)


def realm_near(realm, seed, below=False):
    """A realm near `realm` (the same major, a step or a layer either way), or a major below."""
    major = major_of(realm)
    if below:
        major = max(1, major - 1)
        if major == 1:
            return f"炼气{LAYERS[2 + seed % 5]}层"
        return f"{MAJORS[major]}{STEPS[seed % 2]}"
    if major == 0:
        return "凡人" if seed % 2 else "炼气一层"
    if major == 1:
        layer = next((n for n, word in reversed(list(enumerate(LAYERS))) if f"{word}层" in realm),
                     0)
        return f"炼气{LAYERS[max(0, min(12, layer + seed % 3 - 1))]}层"
    step = next((n for n, word in enumerate(STEPS) if word in realm), 0)
    return f"{MAJORS[major]}{STEPS[max(0, min(2, step + seed % 3 - 1))]}"


def life_rows(state):
    """The mock's own people on the scene, alive: (id, row, bond) with bond 道侣, 弟子 or ''."""
    found = []
    for key, row in sorted((state.get("0") or {}).items()):
        identity = str(row.get("2", "")).partition("|")[2] if isinstance(row, dict) else ""
        if not key.startswith("C") or identity not in (MET, YOUNG):
            continue
        if any(word in str(row.get("4", "")) for word in ("身亡", "坐化", "已死", "陨落")):
            continue
        said = str(row.get("13", ""))
        found.append((key, row, next((kind for kind in ("道侣", "弟子") if f"B1:{kind}" in said),
                                     "")))
    return found


def favour_of(row):
    try:
        return int(str(row.get("15", "0")).strip() or 0)
    except ValueError:
        return 0


def life_people(cards, reply, state, text):
    """The beat's cards and reply with the mock's people: someone met when a scene opens, the
    least liked of the unbonded beyond KEEP off the scene (not one with an entry or a knot the
    beat lists: they stay to settle it), a 道侣 bound or a 弟子 taken; and now and
    then an unkind card aimed at one of them (欺瞒, easy: a player who takes the likeliest takes
    it, and the next beat notes the knot). Not in the opening scene or a gate's big scene."""
    import json as _json

    if (not LIFE_PEOPLE or "开场戏" in text or "冲关的大场面" in text
            or "B1" not in (state.get("0") or {})):
        return cards, reply
    player = state["0"]["B1"]
    realm = str(player.get("2", "")).partition("|")[0]
    gender = "女" if "女" in str(player.get("1", "")).partition("|")[2] else "男"
    rows = state.get("4") or []
    now = str(next((r.get("0", "") for r in rows if isinstance(r, dict)
                    and r.get("id") == "TIME_LOCATION_ROW"), ""))
    import re

    when = re.match(r"(\d+)年 (\d+)月 (\d+)日", now)
    day = ((int(when[1]) - 1) * 360 + (int(when[2]) - 1) * 30 + int(when[3]) - 1) if when else 0
    place = re.search(r"[（(]([^（）()]*)[）)]\s*(\d+,\d+)?", now)
    spot = f"{place[1]} {place[2] or ''}".strip() if place else ""
    mine = life_rows(state)
    commands, lines = [], []
    if "这一拍开一场戏" in text and life_seed(state, text, "meet") % LIFE_MEET == 0:
        # someone met: a peer near the player's realm, or from 筑基 on a youth a realm below
        young = major_of(realm) >= 2 and not any(bond == "弟子" for _, _, bond in mine) and (
            life_seed(state, text, "young") % 2 == 0)
        seed = life_seed(state, text, "who")
        sex = "男女"[seed % 2]
        name = SURNAMES[seed % len(SURNAMES)] + GIVEN[sex][seed // 7 % 5]
        identity = YOUNG if young else MET
        key = f"C{100000 + day}"
        row = {"0": key, "1": f"{name}|{sex}", "2": f"{realm_near(realm, seed, young)}|{identity}",
               "3": NATURES[seed % len(NATURES)], "4": "一切正常",
               "9": f"年龄:{(14 + seed % 4) if young else (18 + seed % 30)}", "13": "", "15": "0",
               "16": f"站在一旁|青布衣衫|{spot}|身形清瘦|眉目平和"}
        commands.append("set(" + _json.dumps(row, ensure_ascii=False) + ")")
        lines.append(f"一个名叫{name}的{identity}也在这里，与你打了个照面。")
        mine.append((key, row, ""))
    # who has something open with the player (the beat lists them by id) stays, to settle it
    owed = set(re.findall(r"（(C[\w-]+)）", text.partition("还没了结的因果")[2].partition("。")[0]
                          + text.partition("还有心结")[2].partition("。")[0]))
    unbonded = [(key, row) for key, row, bond in mine if not bond]
    leaving = sorted((each for each in unbonded if each[0] not in owed),
                     key=lambda each: (favour_of(each[1]), each[0]))
    for key, row in leaving[: max(0, len(unbonded) - KEEP)]:
        commands.append(f'de("{key}")')
        lines.append(f"{str(row.get('1', '')).partition('|')[0]}拱了拱手，先行告辞。")
        mine = [each for each in mine if each[0] != key]
    if not any(bond == "道侣" for _, _, bond in mine):
        for key, row, bond in mine:
            sex = str(row.get("1", "")).partition("|")[2]
            if (not bond and sex and sex != gender and favour_of(row) >= 50
                    and life_seed(state, text, "bond") % 2 == 0):
                commands.append(f'add("{key}",{{"13":"B1:道侣"}})')
                lines.append(f"你与{str(row.get('1', '')).partition('|')[0]}结为道侣。")
                break
    if major_of(realm) >= 2 and not any(bond == "弟子" for _, _, bond in mine):
        for key, row, bond in mine:
            if (not bond and str(row.get("2", "")).endswith(YOUNG)
                    and major_of(row.get("2", "")) < major_of(realm)
                    and life_seed(state, text, "pupil") % 3 == 0):
                commands.append(f'add("{key}",{{"13":"B1:弟子"}})')
                name = str(row.get("1", "")).partition("|")[0]
                lines.append(f"{name}向你行了拜师礼，自此是你的弟子。")
                break
    target = next((each for each in mine if each[0] in (state.get("0") or {})), None)
    if target and life_seed(state, text, "unkind") % 5 == 0:
        name = str(target[1].get("1", "")).partition("|")[0]
        cards = [*cards[:2], f"[欺瞒|编个由头把{name}打发走|{target[0]}|易]", *cards[3:]]
    else:
        cards = life_kind_card(cards, state, text, mine, gender)
    if lines:
        reply = reply.replace("</content>", "\n\n" + "".join(lines) + "</content>", 1)
    if commands:
        reply = reply.replace("</upstore>", "\n" + "\n".join(commands) + "</upstore>", 1)
    return cards, reply


# The beats of a fight, by the words the prompt adds for them (content/life/prompt.json situation:
# met, metGoesOn, fightOpen, fought, foughtAtOnce): the foes stay on the scene through these.
FIGHT_WORDS = ("撞上的是", "还没了结：这一拍", "斗法开始", "斗法到此结束", "一交手就分了胜负")


def life_threads(state):
    """A <threads> block (batch 9): an answer the first person on the scene waits for, and an
    appointment tonight from 亥时 (21:00 to 23:00) at a spot here, on the time row's day."""
    import re

    rows = state.get("0") or {}
    people = sorted(key for key in rows if key.startswith("C") and isinstance(rows[key], dict))
    who = str(rows[people[0]].get("1", "")).partition("|")[0] if people else ""
    row = next((r for r in state.get("4") or []
                if isinstance(r, dict) and r.get("id") == "TIME_LOCATION_ROW"), {})
    day = re.match(r"\d+年 ?\d+月 ?\d+日", str(row.get("0") or ""))
    lines = [f"[给{who or '对方'}一个答复|{who}]"]
    if day:
        lines.append(f"[今夜亥时去后山赴约|||后山|{day[0]} 21:00~{day[0]} 23:00|]")
    return "<threads>\n" + "\n".join(lines) + "\n</threads>"


def life_foes(reply, state, text):
    """The beat's reply with the foes on the scene (identity 敌对) sent off once their fight is
    over, as a story does (the prompt: someone gone from before the protagonist's eyes is de'd).
    The mock never did, and a long run's character table kept every beast and robber it had
    fought. Not in a fight's beats (the encounter, its opening, its close), the opening scene or
    a gate's big scene; only with LIFE_PEOPLE."""
    if (not LIFE_PEOPLE or "开场戏" in text or "冲关的大场面" in text
            or any(word in text for word in FIGHT_WORDS)):
        return reply
    foes = sorted(key for key, row in (state.get("0") or {}).items()
                  if key != "B1" and isinstance(row, dict)
                  and str(row.get("2", "")).partition("|")[2] == "敌对")
    if not foes:
        return reply
    return reply.replace("</upstore>", "\n" + "\n".join(f'de("{key}")' for key in foes)
                         + "</upstore>", 1)


def life_kind_card(cards, state, text, mine, gender):
    """Now and then (one beat in three) an easy friendly talk (交涉, 易) in the first card's place,
    aimed at the best liked of the mock's unbonded people there, one of the other sex first: a
    player who takes the likeliest card takes it, and the engine raises their favour (actions.json
    交涉: 成功 +8) toward 信赖, where a 道侣 is bound and a protector comes to a gate. The long
    runs' favour never rose above 0: the likeliest card was 探查, or the easy 欺瞒."""
    here = [(key, row) for key, row, bond in mine if not bond and key in (state.get("0") or {})]
    if not here or life_seed(state, text, "kind") % 3:
        return cards
    other = [each for each in here
             if str(each[1].get("1", "")).partition("|")[2] not in ("", gender)]
    key, row = max(other or here, key=lambda each: (favour_of(each[1]), each[0]))
    name = str(row.get("1", "")).partition("|")[0]
    return [f"[交涉|与{name}把酒叙话，聊聊近来的见闻|{key}|易]", *cards[1:]]


def life_pedlars(reply, state):
    """The reply with any passing pedlar the settlement renumbered sent off, as the one under
    PEDLAR is the turn after he came (card_turn): once the people's book holds a dead pedlar under
    PEDLAR, a new one is another man under a fresh ID, and card_turn's de(PEDLAR) never reached
    him (sixty of them stood on a long run's scene). Only with LIFE_PEOPLE."""
    if not LIFE_PEOPLE:
        return reply
    gone = sorted(key for key, row in (state.get("0") or {}).items()
                  if key != PEDLAR and isinstance(row, dict)
                  and str(row.get("1", "")).partition("|")[0] == "过路的货郎")
    if not gone:
        return reply
    return reply.replace("</upstore>", "\n" + "\n".join(f'de("{key}")' for key in gone)
                         + "</upstore>", 1)


def life_ledger(payload, messages):
    """The model's note_karma or note_knot in a beat of the life, by the request's seed, when the
    beat offers them (the tool round first; the story follows once the tool has answered): a
    knot after an unkind card the player took, aimed at one of the mock's people there; else an
    open entry or knot the beat lists settled now and then; else now and then a new entry with
    one of them (恩 怨 债 诺, a promise of one to six months)."""
    import json as _json
    import re

    offered = {tool["function"]["name"] for tool in payload.get("tools") or []}
    if not LIFE_PEOPLE or not {"note_karma", "note_knot"} <= offered:
        return None
    user = next(m["content"] for m in messages if m["role"] == "user")
    text = "\n".join(str(m.get("content") or "") for m in messages)
    if "开场戏" in text or "冲关的大场面" in text:
        return None
    _, _, rest = user.partition("【可用实体ID与当前原始状态】\n")
    state = _json.loads(rest.split("\n", 1)[0]) if rest.strip() else {}
    mine = life_rows(state)
    if not mine:
        return None
    took = re.search(r"玩家选了「([^」]+)」（([^）]+)）", user)
    if took:
        kind = UNKIND.get(took[2]) or next((knot for word, knot in UNKIND_WORDS
                                            if word in took[1]), None)
        # the one the card wronged: by the name its title says, else the first of them there
        aimed = next((key for key, row, _ in mine
                      if str(row.get("1", "")).partition("|")[0] in took[1]), mine[0][0])
        if kind:
            return [("note_knot", _json.dumps({"kind": kind, "who": aimed, "what": took[1]},
                                              ensure_ascii=False))]
    seed = life_seed(state, user, "ledger")
    listed = user.partition("还没了结的因果")[2].partition("。")[0]
    held = user.partition("还有心结")[2].partition("。")[0]
    entries = re.findall(r"(Y\d+) \S+?：[^（]*（(\w+)）", listed)
    knots = re.findall(r"(J\d+) \S+?：[^（]*（(\w+)）", held)
    # a knot is settled in one beat of nine it is listed in: it lasts a while, and a gate tried
    # meanwhile raises its 心魔 (one in three left none open at any gate of the long run)
    if knots and seed % 9 == 0:
        knot, who = knots[seed // 9 % len(knots)]
        settled = {"resolve": knot, "who": who, "how": "当面赔了不是，把话说开"}
        return [("note_knot", _json.dumps(settled, ensure_ascii=False))]
    if entries and seed % 3 == 1:
        entry, _ = entries[seed // 3 % len(entries)]
        return [("note_karma", _json.dumps({"done": entry, "how": "这一回当面了结了"},
                                           ensure_ascii=False))]
    if seed % 4 == 2:
        key, row, _ = mine[seed // 4 % len(mine)]
        kind = "恩怨债诺"[seed // 16 % 4]
        name = str(row.get("1", "")).partition("|")[0]
        note = {"kind": kind, "who": key, "what": KARMA[kind].format(名=name)}
        if kind == "诺":
            note["days"] = 30 * (1 + seed // 64 % 6)
        return [("note_karma", _json.dumps(note, ensure_ascii=False))]
    return None


def arrive(text, spot):
    """The time row with the player at `spot`: its bracketed place replaced (or one added)."""
    import re

    if re.search(r"[（(][^（）()]*[）)]", text):
        return re.sub(r"[（(][^（）()]*[）)]", "（" + spot + "）", text, count=1)
    head, _, coords = text.rpartition(" ")
    return f"{head}（{spot}）{coords}" if head else f"{text}（{spot}）"


def first_time(text):
    import re

    match = re.search(r"\d{4}年 ?\d{2}月 ?\d{2}日 ?\d{2}:\d{2}", text)
    return match[0] if match else "某日"


def card_reply(payload):
    """The card-mode answer to a request: text, or a list of tool calls. Besides main turns it
    answers the page's work after a turn: memory archiving, summaries, the daily paper and world
    evolution, each in the form the page reads."""
    import re

    messages = payload["messages"]
    system = next((m["content"] for m in messages if m["role"] == "system"), "") or ""
    text = "\n".join(str(m.get("content") or "") for m in messages)
    if EULOGY in text:
        return eulogy_reply(text)
    if system.startswith(NARRATOR):
        answered = any(m.get("role") == "tool" for m in messages)
        if payload.get("tools") and payload.get("tool_choice") == "required" and not answered:
            # A forced tool round: the engine refuses an empty call, then the story follows.
            return [(payload["tools"][0]["function"]["name"], "{}")]
        if ELABORATE in text:
            return elaborate_reply(messages)
        if LIFE_RULE in text:
            calling = None if answered else (proving_lead(payload, messages)
                                             or granting_chance(payload, messages)
                                             or moving_place(payload, messages)
                                             or life_ledger(payload, messages))
            return calling or life_turn(messages, text)
        return card_turn(messages)
    if "全知史官" in text:
        # One memory per turn, titled by the turn's time, so the count says how many archived.
        when = first_time(text)
        entry = {"title": f"{when}的经历", "content": f"{when}，主角在镇上走动，与人交谈。",
                 "folder": "剧情自动归档"}
        return json.dumps([entry], ensure_ascii=False)
    if "summarizes text concisely" in system:
        return f"<summary>【自动总结】{first_time(text)}，主角四处走动。</summary>"
    if "资深主编" in text:
        news = f"<p>{first_time(text)}，坊间平静无事。</p>"
        paper = f'<div class="paper"><h2>修仙日报</h2>{news}</div>'
        return f"```html\n{paper}\n```"
    if "后台演化模块" in text:
        # The off-screen people's rows: "0":"C9","1":"过路的货郎|男", quotes maybe escaped.
        row = r'\\?"0\\?":\s*\\?"([CG][\w-]*)\\?",\s*\\?"1\\?":\s*\\?"([^"|\\]*)'
        targets = dict(re.findall(row, text))
        commands = "\n".join(f'add("{key}",{{"35":"在外奔走"}})' for key in targets)
        entries = [{"id": key, "title": name, "new_entry": f"{name}在外奔走了一阵。"}
                   for key, name in targets.items()]
        return (f"<upstore>\n{commands}\n</upstore>\n\n```json\n"
                f"{json.dumps(entries, ensure_ascii=False)}\n```")
    return "好的。"


@contextmanager
def provider(card=False):
    server = Provider(("127.0.0.1", 0), Handler)
    server.card = card
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--card", action="store_true", help="answer the card's own requests")
    parser.add_argument("--people", action="store_true",
                        help="in the life, meet people, note karma and knots, bind heirs")
    parser.add_argument("--meet", type=int, default=LIFE_MEET, metavar="N",
                        help="with --people, meet someone at one scene opening in N (default 3)")
    args = parser.parse_args()
    LIFE_PEOPLE = args.people
    LIFE_MEET = max(1, args.meet)
    print(f"TEST DOUBLE ONLY: http://127.0.0.1:{args.port}/v1", flush=True)
    server = Provider(("127.0.0.1", args.port), Handler)
    server.card = args.card
    server.serve_forever()
