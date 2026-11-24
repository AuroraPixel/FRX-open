"""A turn's prompt as the old page builds it, built on the server.

The old page assembled most of each turn's prompt in the browser (sendMessageUnguarded) and
searched the memories there before sending. apps/engine/assemble.cjs and recall.cjs run the
page's own functions for the same result; this module feeds them what the server holds and
answers the requests the memory search makes (embeddings, rerank, a model-led keyword search).

The result is the body the page sent with its turn: user_input, snapshot, turn_action,
variables, player_name and independent_variables, plus the player's log the page saves first.
"""

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import ValidationError

from .card_settings import HOST
from .card_snapshots import engine_payload, engine_result
from .domain import ROOT
from .gateway import ModelFailure
from .turn_runtime import ProxyGenerate, embed, profile_reply, rerank

ENGINE = ROOT / "apps/engine"
PREFERENCES_KEY = "FRX_BROWSER_PREFERENCES_V1"
KNOWLEDGE_KEY = "CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2"
# A search embeds the queries, then reranks, then may embed one query at a time after a
# rejected batch; a model-led search asks for keywords first.
RECALL_PASSES = 5

# Answers one network request of the memory search: {key, method, url, body} -> {status, body}.
Answer = Callable[[dict], Awaitable[dict]]


async def run_script(name, payload, timeout=20, step="提示词拼装"):
    """Run one of the engine's page scripts in an isolated Node process. `step` names it in the
    player's words when it fails. The save goes with a marker in place of each of the server's
    own round snapshots, put back on a save the script returns (card_snapshots.engine_payload)."""
    payload, held = engine_payload(payload)
    process = await asyncio.create_subprocess_exec(
        "node",
        str(ENGINE / name),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output, _ = await asyncio.wait_for(
            process.communicate(json.dumps(payload, ensure_ascii=False).encode()),
            timeout=timeout,
        )
        result = engine_result(json.loads(output), held)
    except (TimeoutError, ValueError):
        raise ModelFailure(step + "未完成") from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode:
        raise ModelFailure(step + "失败：" + "；".join(result.get("errors") or ["未知错误"]))
    return result


def settings_of(rows):
    """The settings table as the page reads it with dbGet: key -> value."""
    return {
        row["value"]["key"]: row["value"].get("value")
        for row in rows
        if isinstance(row.get("value"), dict) and "key" in row["value"]
    }


def visible_vectors(records, archive_id):
    """Memories the page could find for this save: shared ones and the save's own.

    Another save's memories are never visible to the page; the page filters the rest itself.
    """
    return [
        record
        for record in records
        if isinstance(record, dict)
        and (record.get("scope") != "archive" or record.get("archiveId") == archive_id)
    ]


def turn_input(
    archive,
    settings,
    action,
    *,
    seed,
    vectors=(),
    now=None,
    locale="zh-CN",
    time_zone="Asia/Shanghai",
    director_on_server=False,
    session="continued",
):
    """The engine's input for one turn.

    `action` is {text} for typed words or {option} for a picked option, with an optional
    `queue` of the page's addAction calls ({type, data, context, silent}). `session` is what
    the page remembered of the turn before: "continued" for a page that played it, "fresh" for
    one that has just loaded the save. The clock, locale and time zone stand in for the
    player's browser.
    """
    return {
        "archive": archive,
        "settings": settings,
        "preferences": settings.get(PREFERENCES_KEY) or {},
        "vectors": list(vectors),
        "action": action,
        "session": session,
        "seed": seed,
        "now": int(time.time() * 1000) if now is None else now,
        "locale": locale,
        "timeZone": time_zone,
        "frx": {"directorOnServer": director_on_server},
    }


def read_turn_input(records, archive_name, action, **options):
    """The engine's input from one user's records: the save, the settings and the memories."""
    # the prompt never reads the round snapshots a life save keeps beside it
    archive = records.get("archives", archive_name, lean=True)["value"]
    if not archive or not isinstance(archive.get("data"), dict):
        raise ModelFailure("存档不存在")
    settings = settings_of(records.list("settings"))
    # This save's memories and the shared ones, read by the archive_id column: the rows the
    # page's search could see, without loading every other save's vectors.
    archive_id = archive["data"].get("archiveId")
    vectors = visible_vectors(records.archive_memories(archive_id, include_shared=True), archive_id)
    return turn_input(archive, settings, action, vectors=vectors, **options)


def searches_memory(turn):
    """Whether the page would search the memories at all; it never does without both."""
    knowledge = (turn.get("settings") or {}).get(KNOWLEDGE_KEY) or {}
    return bool(turn.get("vectors")) and bool(knowledge.get("vectorAutoInject"))


PROFILE_CALL = re.compile(re.escape(HOST) + r"/profiles/([\w-]+)(?:/v1)?/chat/completions")


def answerer(profiles) -> Answer:
    """Answers the page functions' network requests with the server's own services: embeddings,
    rerank, and calls through a model profile. These are not HTTP routes: the engine runs the
    page's functions in Node, and the requests they make of the page's server, at the engine's
    host (/host/…), come back here as `needs`."""

    async def answer(need):
        path = urlsplit(need["url"]).path
        body = need.get("body")
        try:
            body = json.loads(body) if isinstance(body, str) else body
            if path == HOST + "/embeddings":
                texts = body["input"] if isinstance(body["input"], list) else [body["input"]]
                result = await embed(profiles, texts)
            elif path == HOST + "/rerank":
                result = await rerank(profiles, body["query"], body["documents"])
            elif match := PROFILE_CALL.fullmatch(path):
                payload = ProxyGenerate.model_validate(body)
                result = await profile_reply(profiles, match[1], payload)
                if payload.stream:
                    # The page reads a streamed call as events; the whole reply comes as one.
                    text = result["choices"][0]["message"]["content"] or ""
                    delta = {"choices": [{"delta": {"content": text}}]}
                    result = f"data: {json.dumps(delta, ensure_ascii=False)}\n\ndata: [DONE]\n\n"
            else:
                return {"status": 404, "body": {"detail": "接口不存在"}}
        except HTTPException as exc:
            return {"status": exc.status_code, "body": {"detail": exc.detail}}
        except ModelFailure as exc:
            return {"status": 502, "body": {"detail": str(exc), "error": {"message": str(exc)}}}
        except (KeyError, TypeError, ValueError, ValidationError):
            return {"status": 422, "body": {"detail": "请求格式无效"}}
        return {"status": 200, "body": result}

    return answer


async def recall(turn, answer: Answer):
    """The page's memory search for this turn, in passes: the engine lists the requests it
    needs, `answer` fetches each one, and the engine runs again with the answers."""
    answers = dict(turn.get("answers") or {})
    for _ in range(RECALL_PASSES):
        result = await run_script("recall.cjs", {**turn, "answers": answers})
        if result.get("done"):
            return result
        for need in result["needs"]:
            answers[need["key"]] = await answer(need)
    raise ModelFailure("记忆召回未完成")


async def assemble(turn, recalled=None):
    """The request body the page would send, from the turn input and the memory search."""
    result = await run_script("assemble.cjs", {**turn, "recall": recalled})
    if result.get("user_input") is None:
        raise ModelFailure("本回合没有可发送的内容")
    return result


async def build(turn, answer: Answer):
    """Recall, then assembly: the whole prompt of a turn."""
    recalled = await recall(turn, answer) if searches_memory(turn) else None
    return await assemble(turn, recalled)
