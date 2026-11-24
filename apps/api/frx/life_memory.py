"""Bounded, read-only evidence for a life scene and the plot director."""

import json
import re

from .domain import ROOT

EVENT_NAMES = {event["id"]: event["name"]
               for event in json.loads((ROOT / "content/life/saga.json").read_text())["events"]}
STAGES = {"rumour": "传闻", "approach": "逼近", "happen": "已发生", "aftermath": "余波"}
WORD = re.compile(r"[\u3400-\u9fff]+|[a-zA-Z]{2,}")


def fragments(text):
    """Pairs of adjacent characters match names even when the surrounding wording changes."""
    return {word[i:i + 2] for word in WORD.findall(text.lower()) for i in range(len(word) - 1)}


def relevant(entries, focus, limit):
    wanted = fragments(focus)
    ranked = sorted(enumerate(entries), key=lambda item: (
        len(wanted & fragments(json.dumps(item[1], ensure_ascii=False))) if wanted else 0,
        item[0]), reverse=True)
    # Keep their original order for narration, after selecting relevant or recent entries.
    return [entry for _, entry in sorted(ranked[:limit])]


def clipped(entry, fields):
    return {key: entry[key][:limit] for key, limit in fields.items()
            if isinstance(entry.get(key), str) and entry[key]}


def event_records(play):
    world = play.get("world") or {}
    for key, record in (world.get("events") or {}).items():
        past = (world.get("past") or {}).get(key) or {}
        for occurrence in [*past.values(), record]:
            if not isinstance(occurrence, dict) or not occurrence.get("at"):
                continue
            stages = occurrence.get("stages") or {}
            stage = next((name for name in reversed(STAGES) if name in stages), None)
            if stage is None and not occurrence.get("entered"):
                continue
            event = {"event": EVENT_NAMES.get(key, key), "at": occurrence["at"]}
            if stage:
                event.update(stage=STAGES[stage], since=stages[stage])
            if occurrence.get("entered"):
                event["entered"] = occurrence["entered"]
            facts = [v[:96] for v in occurrence.get("facts") or [] if isinstance(v, str)]
            if facts:
                event["facts"] = facts[:3]
            offers = [clipped(v, {"text": 64, "status": 12, "expires": 16})
                      for v in occurrence.get("opportunities") or [] if isinstance(v, dict)]
            if offers:
                event["opportunities"] = offers[-4:]
            yield event


def active_matters(play):
    rows = []
    for thread in play.get("threads") or []:
        if not isinstance(thread, dict) or thread.get("completed") or thread.get("followUp"):
            continue
        row = clipped(thread, {"id": 20, "text": 100})
        if not row.get("id") or not row.get("text"):
            continue
        progress = thread_progress(thread)
        if progress:
            row["progress"] = progress
        rows.append(row)
    return rows[:8]


def life_evidence(play, focus=""):
    events = sorted(event_records(play), key=lambda entry: entry["at"])
    known = []
    for clue in play.get("clues") or []:
        if not isinstance(clue, dict) or not isinstance(clue.get("text"), str):
            continue
        entry = clipped(clue, {"id": 20, "date": 16, "text": 110})
        origin = clue.get("origin")
        if isinstance(origin, dict):
            entry["origin"] = clipped(origin, {"event": 32, "at": 16, "stage": 16, "since": 16})
        elif clue.get("kind") == "rumour":
            # Existing clue keys already identify the event, stage and its date.
            parts = str(clue.get("key") or "").split(":", 4)
            if len(parts) == 5 and parts[0] == "rumour" and parts[1] in EVENT_NAMES:
                entry["origin"] = {"event": parts[1], "stage": parts[2], "since": parts[3]}
        known.append(entry)
    past = []
    for thread in play.get("threadHistory") or []:
        if isinstance(thread, dict) and thread.get("status"):
            row = clipped(thread, {"id": 20, "text": 80, "status": 12, "date": 16,
                                   "result": 96, "place": 32, "spot": 32})
            progress = thread_progress(thread)
            if progress:
                row["progress"] = progress
            past.append(row)
    fields = {"worldEvents": relevant(events, focus, 4), "knownClues": relevant(known, focus, 6),
              "pastMatters": relevant(past, focus, 4)}
    return {key: value for key, value in fields.items() if value}


def thread_progress(thread):
    return [part[:96] for part in (thread.get("progress") or [])[-3:] if isinstance(part, str)]


def past_accounts(logs, focus, read_story):
    """Recall committed accounts and relevant entries from the annals."""
    wanted = fragments(focus)
    if not wanted:
        return []
    matches = {}
    for position, log in enumerate(logs):
        summary = log.get("smallSummary") or log.get("largeSummary")
        entries = [("当时记载", summary)] if isinstance(summary, str) else []
        if not entries and not log.get("frxChronicle"):
            story = read_story(log.get("content"))
            entries.extend(("当时原文", part) for part in re.split(r"[。！？\n]", story) if part)
        for line in log.get("frxChronicle") or []:
            if isinstance(line, dict) and isinstance(line.get("text"), str):
                entries.append(("年谱", line["text"]))
        for source, text in entries:
            text = text.strip()[:240]
            overlap = len(wanted & fragments(text))
            if overlap >= 2:
                matches[text] = (overlap, position, source)
    best = sorted(matches, key=lambda text: matches[text][:2], reverse=True)[:3]
    return [{"source": matches[text][2], "text": text}
            for text in sorted(best, key=lambda text: matches[text][1])]
