"""The player's settings that both interfaces share (plan item 47, server side), kept exactly
where the old page keeps them so that a change in one interface shows in the other:

- the standing note is the old page's permanent prompt (CULTIVATION_PERMANENT_PROMPTS_V1): the
  active prompt's text, in which {{userInput}} stands for what the player wrote. A note written in
  the new interface without that placeholder is kept as a prompt of its own, 常驻指示, that puts
  the player's words first and the note after them, and is shown back without the placeholder;
- the world's evolution is the old page's world evolution switch and frequency
  (CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1 enabled and frequency);
- plot evolution is the director's switch and frequency in the same record
  (plotEvolutionEnabled, plotEvolutionFrequency), written with plotEvolutionChosen as the old page
  writes it, since the director only honours a chosen value (card_director.director_settings);
- the daily paper is the old page's automatic theatre in the browser preferences it mirrors to
  the server (FRX_BROWSER_PREFERENCES_V1: theater_autoGenEnabled, theater_autoGenFrequency,
  theater_roundsInterval, theater_injectToContext), kept as the strings the browser stores;
- memory and biographies are the switches of CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2
  (vectorAutoSave, vectorAutoSaveFrequency, vectorAutoInject; knowledgeBaseEnabled).

The server's jobs already follow these values (play_jobs, play_prompt, card_director). Never
saved, each reads as the old page's default: everything off, except plot evolution, which
follows the director. A write changes only its own keys; the rest of each record stays.

Model connections are shared by everyone on the server: the main connection (address, key,
model) and the model each purpose uses (card_profiles). Keys are written, never read back.
"""

import copy
import re

from fastapi import HTTPException

from . import play_models as M
from .card_director import SETTINGS_KEY as EVOLUTION_KEY
from .card_director import director_settings
from .card_turns import tool_capable
from .play_errors import PlayError
from .play_prompt import KNOWLEDGE_KEY, PREFERENCES_KEY

PROMPTS_KEY = "CULTIVATION_PERMANENT_PROMPTS_V1"
PLACEHOLDER = "{{userInput}}"
NOTE_ID = "frx-standing-note"
NOTE_PREFIX = PLACEHOLDER + "\n\n"
# What managePermanentPrompts writes the first time the old page opens its prompts.
DEFAULT_PROMPTS = {
    "activePromptId": None,
    "prompts": [
        {
            "id": "default-anti-hallucination",
            "name": "防口胡模板",
            "content": "请检查我的输入 {{userInput}} 是否存在口胡情况，"
            "例如使用不存在的物品或者强行引导事件，如果存在，判定为口胡，将对用户进行惩罚",
            "isDefault": True,
        }
    ],
}
# The keys of the stored records that the player's settings write (changes_of): the player's
# own. A background job (play_jobs) that read a record before the player changed it never writes
# them back.
PLAYER_KEYS = {
    EVOLUTION_KEY: frozenset(
        {"enabled", "frequency", "plotEvolutionEnabled", "plotEvolutionFrequency",
         "plotEvolutionChosen"}
    ),
    PREFERENCES_KEY: frozenset(
        {"theater_autoGenEnabled", "theater_autoGenFrequency", "theater_roundsInterval",
         "theater_injectToContext", "theater_isDailyPaperMode"}
    ),
    KNOWLEDGE_KEY: frozenset(
        {"vectorAutoSave", "vectorAutoSaveFrequency", "vectorAutoInject", "knowledgeBaseEnabled"}
    ),
}
FREQUENCY = (1, 50)
# The old page's number inputs: the daily paper's interval and the archiving frequency.
TURNS = (1, 100)
PAPER_FREQUENCIES = ("always", "rounds", "daily")


def page_int(value):
    """parseInt as the old page applies it to a stored value: the leading integer, or None."""
    match = re.match(r"\s*([+-]?\d+)", str(value)) if value is not None else None
    return int(match.group(1)) if match else None


def within(value, bounds):
    return min(max(value, bounds[0]), bounds[1])


def setting(records, key):
    """(value, version) of one setting as the old page reads it."""
    envelope = records.get("settings", key)
    value = envelope["value"]
    return (value.get("value") if isinstance(value, dict) else None), envelope["version"]


def update_setting(records, key, change, attempts=3):
    """Read, change and write one setting with its version, as the old page's dbSet does; a write
    that lost a race with another one is read and applied again."""
    for _ in range(attempts):
        value, version = setting(records, key)
        changed = change(copy.deepcopy(value))
        try:
            records.write("settings", key, {"key": key, "value": changed}, version)
            return
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
    raise PlayError(409, "version_conflict", "设置在别处被同时修改，请重试")


def standing_note(prompts):
    if not isinstance(prompts, dict) or not prompts.get("activePromptId"):
        return None
    active = next(
        (
            p
            for p in prompts.get("prompts") or []
            if isinstance(p, dict) and p.get("id") == prompts["activePromptId"]
        ),
        None,
    )
    content = active.get("content") if active else None
    if not isinstance(content, str) or not content:
        return None
    return content.removeprefix(NOTE_PREFIX)


def with_note(prompts, note):
    """The permanent prompts with the standing note in effect, or none in effect for ''."""
    if not isinstance(prompts, dict) or not isinstance(prompts.get("prompts"), list):
        prompts = copy.deepcopy(DEFAULT_PROMPTS)
    note = note.strip()
    if not note:
        prompts["activePromptId"] = None
        return prompts
    content = note if PLACEHOLDER in note else NOTE_PREFIX + note
    own = next(
        (p for p in prompts["prompts"] if isinstance(p, dict) and p.get("id") == NOTE_ID), None
    )
    if own is None:
        own = {"id": NOTE_ID, "name": "常驻指示", "content": content, "isDefault": False}
        prompts["prompts"].append(own)
    own["content"] = content
    prompts["activePromptId"] = NOTE_ID
    return prompts


def evolution_of(config):
    config = config if isinstance(config, dict) else {}
    try:
        frequency = int(config.get("frequency") or 1)
    except (TypeError, ValueError):
        frequency = 1
    frequency = min(max(frequency, FREQUENCY[0]), FREQUENCY[1])
    return M.EvolutionSettings(enabled=bool(config.get("enabled")), frequency=frequency)


def plot_of(config, director_runs):
    """Plot evolution as the director applies it (Director.settings)."""
    chosen = director_settings(config, director_runs)
    return M.PlotSettings(enabled=chosen["enabled"], frequency=chosen["frequency"])


def paper_of(preferences):
    """The daily paper as the old page's theatre reads its stored strings (app.js 1719–1760)."""
    preferences = preferences if isinstance(preferences, dict) else {}
    frequency = preferences.get("theater_autoGenFrequency") or "always"
    rounds = preferences.get("theater_roundsInterval") or preferences.get("theater_autoGenRounds")
    return M.PaperSettings(
        enabled=preferences.get("theater_autoGenEnabled") == "true",
        # any other value schedules like 'always': the page only tests for the other two
        frequency=frequency if frequency in PAPER_FREQUENCIES else "always",
        rounds=within(page_int(rounds) or 3, TURNS),
        into_prompt=preferences.get("theater_injectToContext") == "true",
    )


def memory_of(knowledge):
    knowledge = knowledge if isinstance(knowledge, dict) else {}
    return M.MemorySettings(
        archive=bool(knowledge.get("vectorAutoSave")),
        frequency=within(page_int(knowledge.get("vectorAutoSaveFrequency")) or 1, TURNS),
        recall=bool(knowledge.get("vectorAutoInject")),
    )


def biographies_of(knowledge):
    knowledge = knowledge if isinstance(knowledge, dict) else {}
    return M.BiographySettings(enabled=bool(knowledge.get("knowledgeBaseEnabled")))


def director_runs_here(profiles):
    """Whether the server runs plot evolution: card_director's server_owned, which asks whether
    the evolution profile's model passed tool admission."""
    try:
        return tool_capable(profiles.load("evolution").model)
    except Exception:
        return False


def read_settings(records, director_runs=True):
    prompts, _ = setting(records, PROMPTS_KEY)
    evolution, _ = setting(records, EVOLUTION_KEY)
    preferences, _ = setting(records, PREFERENCES_KEY)
    knowledge, _ = setting(records, KNOWLEDGE_KEY)
    return M.PlaySettings(
        standing_note=standing_note(prompts),
        evolution=evolution_of(evolution),
        plot=plot_of(evolution, director_runs),
        paper=paper_of(preferences),
        memory=memory_of(knowledge),
        biographies=biographies_of(knowledge),
        plot_runs=director_runs,
    )


def page_flag(value):
    """A switch as the browser stores it (localStorage keeps strings)."""
    return "true" if value else "false"


def changes_of(wanted: M.PlaySettings):
    """{key: [change]}: what the request changes in each stored record, its own keys only."""
    changes = {}

    def put(key, values):
        changes.setdefault(key, []).append(values)

    if wanted.evolution is not None:
        put(
            EVOLUTION_KEY,
            {"enabled": wanted.evolution.enabled, "frequency": wanted.evolution.frequency},
        )
    if wanted.plot is not None:
        put(
            EVOLUTION_KEY,
            {
                "plotEvolutionEnabled": wanted.plot.enabled,
                "plotEvolutionFrequency": wanted.plot.frequency,
                "plotEvolutionChosen": True,
            },
        )
    if wanted.paper is not None:
        paper = wanted.paper
        values = {
            "theater_autoGenEnabled": page_flag(paper.enabled),
            "theater_autoGenFrequency": paper.frequency,
            "theater_roundsInterval": str(paper.rounds),
            "theater_injectToContext": page_flag(paper.into_prompt),
        }
        if paper.enabled:
            # what the old page writes with every save of its theatre (app.js 4819)
            values["theater_isDailyPaperMode"] = "true"
        put(PREFERENCES_KEY, values)
    if wanted.memory is not None:
        put(
            KNOWLEDGE_KEY,
            {
                "vectorAutoSave": wanted.memory.archive,
                "vectorAutoSaveFrequency": wanted.memory.frequency,
                "vectorAutoInject": wanted.memory.recall,
            },
        )
    if wanted.biographies is not None:
        put(KNOWLEDGE_KEY, {"knowledgeBaseEnabled": wanted.biographies.enabled})
    return changes


def write_settings(records, wanted: M.PlaySettings, director_runs=True):
    if wanted.standing_note is not None:
        note = wanted.standing_note
        update_setting(records, PROMPTS_KEY, lambda prompts: with_note(prompts, note))
    for key, values in changes_of(wanted).items():

        def change(record, values=values):
            record = record if isinstance(record, dict) else {}
            for each in values:
                record.update(each)
            return record

        update_setting(records, key, change)
    return read_settings(records, director_runs)


# ---------------------------------------------------------------- model connections


def profile_problem(exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "模型档案无法修改"
    if exc.status_code == 404:
        return PlayError(404, "not_found", detail)
    return PlayError(409, "version_conflict", detail)


async def available_models(profiles, name):
    """The models the profile's own connection offers (the model service's /models)."""
    import httpx

    try:
        config = profiles.load(name)
    except HTTPException as exc:
        raise profile_problem(exc) from None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                config.base_url + "/models",
                headers={"Authorization": "Bearer " + config.api_key.get_secret_value()},
            )
            response.raise_for_status()
            listed = response.json()["data"]
            return {
                "models": sorted(
                    {
                        item["id"]
                        for item in listed
                        if isinstance(item.get("id"), str) and len(item["id"]) <= 200
                    }
                )[:300]
            }
    except Exception:
        raise PlayError(502, "model_failed", "无法读取模型清单，请检查模型连接") from None


# A check asks for a reply this short; and gives up after this long.
CHECK_TOKENS = 16
CHECK_SECONDS = 30


def refusal_reason(response, secret):
    """What a model service said when it refused a call, short and without the key."""
    try:
        body = response.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    said = (error.get("message") if isinstance(error, dict) else error) or (
        body.get("detail") if isinstance(body, dict) else None)
    said = said if isinstance(said, str) and said.strip() else f"HTTP {response.status_code}"
    if secret:
        said = said.replace(secret, "…")
    return " ".join(said.split())[:120]


async def check_model(profiles, name, model):
    """One tiny call to the profile's connection with `model` (a reply of a few tokens, or one
    embedding for the embedding profile): whether the model answers. The list of models is what
    the service says it has, and a relay lists models it cannot route (实玩二: gemini-3.7-flash-
    high, listed by the relay, answered `unknown provider` and the turn failed)."""
    import httpx

    try:
        config = profiles.load(name)
    except HTTPException as exc:
        raise profile_problem(exc) from None
    model = model.strip() or config.model
    if not model:
        raise PlayError(422, "invalid_input", "先写一个模型名")
    secret = config.api_key.get_secret_value()
    if name == "embedding":
        path, body = "/embeddings", {"model": model, "input": "试"}
    else:
        path, body = "/chat/completions", {
            "model": model, "messages": [{"role": "user", "content": "答一个字：好"}],
            "max_tokens": CHECK_TOKENS, "stream": False,
        }
    try:
        async with httpx.AsyncClient(timeout=CHECK_SECONDS) as client:
            response = await client.post(
                config.base_url + path, json=body, headers={"Authorization": "Bearer " + secret}
            )
    except Exception:
        raise PlayError(
            502, "model_failed", f"「{model}」没有回答：连不上模型服务，请检查模型连接。"
        ) from None
    if response.status_code >= 400:
        said = f"「{model}」没有回答（{refusal_reason(response, secret)}）。"
        raise PlayError(502, "model_failed", said + "用它的回合会写不出来，换一个模型。")
    return {"model": model, "answers": True}
