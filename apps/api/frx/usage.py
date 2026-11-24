"""Model usage per user, the limits on it, and the turns a server plays at once.

Every model call the server makes is recorded in usage_events under the user whose work it was:

- a main turn (tool rounds and rewrites included) as one event when it ends, from the turn's own
  metrics (turn_runtime.pilot_stream / upstore_stream), purpose "turn";
- a retried settlement, each call ("retry");
- the work after a turn (memory archiving, summaries, the daily paper, world evolution), each
  call ("after:<job>");
- memory recall's embeddings, reranking and keyword search ("recall") and a rebuild of a save's
  memory ("rebuild"), each call (rows from before the old page went may say "page": its calls
  through the profile proxy);
- a plot-evolution run as one event from its own metrics ("director").

Calls deep in shared code (embed, rerank, profile_reply) are recorded through `note`, which
finds whose work it is in the ambient scope that the turn, the job or the route set (`scope`,
`task_context`). A call outside any scope is not recorded.

Limits (multi-user mode only; local mode records and limits nothing): each player's cost and main
turns over the last 24 hours, main turns at once per player and for the whole server, and the
storage a player may keep (saves, one save's size, pictures). Defaults come from the environment
(FRX_LIMIT_*) and an administrator may set a player's own (users.limits). Administrators are not
held to the cost and turn limits; their usage is recorded all the same.
"""

import contextvars
import logging
import math
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass, fields, replace

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .play_errors import PlayError
from .storage import Base, bind_user

logger = logging.getLogger(__name__)

WINDOW = 24 * 3600


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    at: Mapped[float] = mapped_column(Float)
    purpose: Mapped[str] = mapped_column(String(24))
    profile: Mapped[str] = mapped_column(String(24))
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    calls: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    reported: Mapped[bool] = mapped_column(Boolean)
    __table_args__ = (Index("ix_usage_events_user_at", "user_id", "at"),)


# ---------------------------------------------------------------- limits


@dataclass(frozen=True)
class Limits:
    """What one user may do; None is no limit."""

    cost: float | None = None  # US dollars over the last 24 hours
    turns: int | None = None  # main turns over the last 24 hours
    concurrent: int | None = None  # main turns at once
    saves: int | None = None
    save_bytes: int | None = None
    image_bytes: int | None = None


NO_LIMITS = Limits()
MB = 1024 * 1024
# name -> (environment variable, default, unit); "none" in the environment is no limit.
DEFAULTS = {
    "cost": ("FRX_LIMIT_COST", "3", float),
    "turns": ("FRX_LIMIT_TURNS", "200", int),
    "concurrent": ("FRX_LIMIT_CONCURRENT", "2", int),
    "saves": ("FRX_LIMIT_SAVES", "50", int),
    "save_bytes": ("FRX_LIMIT_SAVE_MB", "50", MB),
    "image_bytes": ("FRX_LIMIT_IMAGE_MB", "200", MB),
}
SERVER_TURNS = ("FRX_LIMIT_SERVER_TURNS", "6")


def _number(text, unit):
    text = str(text).strip().lower()
    if text in {"", "none", "off", "unlimited"}:
        return None
    if unit is float:
        value = float(text)
    elif unit is int:
        value = int(text)
    else:
        value = int(float(text) * unit)
    if value < 0 or (isinstance(value, float) and not math.isfinite(value)):
        raise ValueError(text)
    return value


def default_limits():
    """The limits of a player without limits of their own, from the environment."""
    values = {}
    for name, (variable, default, unit) in DEFAULTS.items():
        raw = os.getenv(variable, default)
        try:
            values[name] = _number(raw, unit)
        except ValueError:
            raise RuntimeError(f"{variable}={raw}：请写非负的数，或 none 表示不设限") from None
    return Limits(**values)


def server_turns():
    raw = os.getenv(*SERVER_TURNS)
    try:
        return _number(raw, int)
    except ValueError:
        raise RuntimeError(f"{SERVER_TURNS[0]}={raw}：请写非负整数，或 none 表示不设限") from None


def limits_for(role, own, mode):
    """A user's effective limits: none in local mode; otherwise the defaults with the user's own
    (users.limits: a field set to a number replaces the default, set to null removes the limit),
    and for an administrator no cost or turn limit."""
    if mode != "on":
        return NO_LIMITS
    limits = default_limits()
    if isinstance(own, dict):
        names = {field.name for field in fields(Limits)}
        limits = replace(limits, **{k: v for k, v in own.items() if k in names})
    if role == "admin":
        limits = replace(limits, cost=None, turns=None)
    return limits


def limits_view(limits):
    """The account's limits as the contract names them; absent: no limit."""
    view = {
        "cost": limits.cost,
        "turns": limits.turns,
        "concurrent_turns": limits.concurrent,
        "saves": limits.saves,
        "save_bytes": limits.save_bytes,
        "image_bytes": limits.image_bytes,
    }
    return {key: value for key, value in view.items() if value is not None}


# ---------------------------------------------------------------- the ambient scope


@dataclass(frozen=True)
class Scope:
    meter: "Meter"
    user_id: str
    purpose: str
    request_id: str | None = None


_scope = contextvars.ContextVar("frx_usage_scope", default=None)


@contextmanager
def scope(meter, user_id, purpose, request_id=None):
    """Calls noted inside are the user's, for this purpose."""
    if meter is None:
        yield
        return
    token = _scope.set(Scope(meter, user_id, purpose, request_id))
    try:
        yield
    finally:
        _scope.reset(token)


def enter(meter, user_id, purpose, request_id=None):
    """Set the scope for the rest of the current task (a route's own task)."""
    if meter is not None:
        _scope.set(Scope(meter, user_id, purpose, request_id))


def task_context(meter, user_id, purpose, request_id=None):
    """A copy of the current context with the scope set, for a task started with it."""
    context = contextvars.copy_context()
    if meter is not None:
        context.run(_scope.set, Scope(meter, user_id, purpose, request_id))
    return context


def current():
    return _scope.get()


def _get(item, key):
    if item is None:
        return None
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def counts_of(usage):
    """(input tokens, output tokens, cost or None, reported) from an OpenAI-style usage."""
    if not usage:
        return 0, 0, None, False
    prompt = _get(usage, "prompt_tokens") or 0
    completion = _get(usage, "completion_tokens") or 0
    cost = _get(usage, "cost")
    cost = float(cost) if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None
    try:
        return int(prompt), int(completion), cost, True
    except (TypeError, ValueError):
        return 0, 0, cost, True


def record_call(profile, usage=None, *, calls=1):
    """Record one model call in the current scope, with its usage (several usages summed when
    the call took more than one request)."""
    found = _scope.get()
    if found is None:
        logger.debug("usage_unscoped profile=%s", profile)
        return
    usages = usage if isinstance(usage, list) else [usage]
    tokens_in = tokens_out = 0
    cost = None
    reported = bool(usages)
    for item in usages:
        prompt, completion, spent, seen = counts_of(item)
        tokens_in += prompt
        tokens_out += completion
        if spent is not None:
            cost = (cost or 0.0) + spent
        reported = reported and seen
    found.meter.record(
        found.user_id, found.purpose, profile, request_id=found.request_id, calls=calls,
        input_tokens=tokens_in, output_tokens=tokens_out, cost=cost, reported=reported,
    )


async def note(profile, usage=None, *, calls=1):
    """record_call from async code, off the event loop."""
    import asyncio

    if _scope.get() is None:
        return
    await asyncio.to_thread(record_call, profile, usage, calls=calls)


# ---------------------------------------------------------------- the meter


def duration(seconds):
    seconds = max(60, int(seconds))
    hours, minutes = divmod(round(seconds / 60), 60)
    if hours and minutes:
        return f"{hours} 小时 {minutes} 分钟"
    return f"{hours} 小时" if hours else f"{minutes} 分钟"


class Meter:
    """The usage ledger and the gates in front of model calls, for one server.

    `mode` is FRX_AUTH's: "on" limits players, anything else (local mode) only records."""

    def __init__(self, sessions, mode="off"):
        self.sessions = sessions
        self.mode = mode
        self.clock = time.time
        self.server_turns = server_turns() if mode == "on" else None

    # ------------------------------------------------------------ recording

    def record(self, user_id, purpose, profile, *, request_id=None, calls=1, input_tokens=0,
               output_tokens=0, cost=None, reported=True):
        try:
            with bind_user(self.sessions, user_id).begin() as session:
                session.add(UsageEvent(
                    user_id=user_id, at=self.clock(), purpose=purpose[:24],
                    profile=str(profile)[:24], request_id=request_id, calls=int(calls),
                    input_tokens=int(input_tokens), output_tokens=int(output_tokens),
                    cost=cost, reported=bool(reported),
                ))
        except Exception as error:  # accounting never fails the work it accounts for
            logger.warning("usage_record_failed purpose=%s error=%s", purpose,
                           type(error).__name__)

    def record_metrics(self, user_id, purpose, profile, metrics, request_id=None):
        """One event from a turn's or a run's own metrics (TurnMetrics or the director's Usage
        snapshot): calls, tokens, cost and whether the upstream reported usage."""
        if not metrics or not metrics.get("calls"):
            return
        cost = metrics.get("cost")
        self.record(
            user_id, purpose, profile, request_id=request_id, calls=metrics["calls"],
            input_tokens=metrics.get("promptTokens") or 0,
            output_tokens=metrics.get("completionTokens") or 0,
            cost=float(cost) if cost else None, reported=bool(metrics.get("usageReported")),
        )

    # ------------------------------------------------------------ reading

    def events(self, user_id, since):
        with bind_user(self.sessions, user_id)() as session:
            return session.execute(
                select(UsageEvent.at, UsageEvent.purpose, UsageEvent.calls,
                       UsageEvent.input_tokens, UsageEvent.output_tokens, UsageEvent.cost,
                       UsageEvent.reported)
                .where(UsageEvent.user_id == user_id, UsageEvent.at > since)
                .order_by(UsageEvent.at)
            ).all()

    def totals(self, user_id, since=None):
        """The user's usage since `since` (default: the last 24 hours), in all and by purpose."""
        since = self.clock() - WINDOW if since is None else since
        rows = self.events(user_id, since)
        total = _totals(rows)
        purposes = sorted({row.purpose for row in rows})
        by_purpose = [
            {"purpose": purpose, **_totals([row for row in rows if row.purpose == purpose])}
            for purpose in purposes
        ]
        return total, by_purpose

    def stored(self, user_id):
        """The saves and picture bytes the user keeps now."""
        from .card_media import IMAGE, UserFile
        from .save_schema import Archive

        with bind_user(self.sessions, user_id)() as session:
            saves = session.scalar(
                select(func.count()).select_from(Archive).where(
                    Archive.user_id == user_id, Archive.deleted.is_(False))
            )
            images = session.scalar(
                select(func.coalesce(func.sum(UserFile.size), 0)).where(
                    UserFile.user_id == user_id, UserFile.kind == IMAGE)
            )
        return {"saves": int(saves or 0), "image_bytes": int(images or 0)}

    # ------------------------------------------------------------ the gates

    def quota_problem(self, user_id, limits):
        """(message, seconds until a new call may go) when the user is at a cost or turn limit
        over the last 24 hours, else None."""
        if limits is None or (limits.cost is None and limits.turns is None):
            return None
        now = self.clock()
        rows = self.events(user_id, now - WINDOW)
        waits, reached = [], []
        if limits.turns is not None:
            turns = [row.at for row in rows if row.purpose == "turn"]
            if len(turns) >= limits.turns:
                # The turn whose leaving the window brings the count under the limit.
                first = turns[len(turns) - limits.turns] if limits.turns else now
                waits.append(first + WINDOW - now)
                reached.append(f"主回合 {limits.turns} 个")
        if limits.cost is not None:
            spent = [(row.at, row.cost) for row in rows if row.cost]
            total = sum(cost for _, cost in spent)
            if total >= limits.cost:
                at = now
                for at, cost in spent:
                    total -= cost
                    if total < limits.cost:
                        break
                waits.append(at + WINDOW - now)
                reached.append(f"费用 {limits.cost:.2f} 美元")
        if not waits:
            return None
        wait = max(max(waits), 1)
        message = (
            "最近 24 小时的用量已到上限（" + "、".join(reached) + "），约 "
            + duration(wait) + "后可以再玩"
        )
        return message, wait

    def check(self, user):
        """Raise 429 quota_exceeded when the user may not start a model call now."""
        problem = self.quota_problem(user.id, user.limits)
        if problem:
            message, wait = problem
            raise PlayError(429, "quota_exceeded", message,
                            headers={"Retry-After": str(math.ceil(wait))})

    def check_user_id(self, user_id):
        """quota_problem for work that knows only the user's id (the director)."""
        if self.mode != "on":
            return None
        from .auth import UserRecord

        with self.sessions() as session:
            row = session.get(UserRecord, user_id)
        if row is None:
            return None
        return self.quota_problem(user_id, limits_for(row.role, row.limits, self.mode))

    def admit(self, user, running):
        """Raise 429 busy when a new main turn would go past the user's turns at once or the
        server's; `running` lists the user ids of the turns in progress now. Synchronous, so
        the caller can register the new turn before anything else runs."""
        if self.mode != "on":
            return
        running = list(running)
        limit = (user.limits or NO_LIMITS).concurrent
        if limit is not None and sum(1 for owner in running if owner == user.id) >= limit:
            raise PlayError(429, "busy", f"你已有 {limit} 个回合在进行，请等其中一个结束再继续",
                            headers={"Retry-After": "5"})
        if self.server_turns is not None and len(running) >= self.server_turns:
            raise PlayError(429, "busy", "服务器繁忙，请稍后再试", headers={"Retry-After": "10"})


def _totals(rows):
    costs = [row.cost for row in rows if row.cost is not None]
    return {
        "calls": sum(row.calls for row in rows),
        "input_tokens": sum(row.input_tokens for row in rows),
        "output_tokens": sum(row.output_tokens for row in rows),
        "cost": round(sum(costs), 6),
        "cost_reported": bool(rows) and len(costs) == len(rows),
        "turns": sum(1 for row in rows if row.purpose == "turn"),
    }
