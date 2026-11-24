"""Execution budgets and durable reservations shared by every turn reader and writer."""

import time
from datetime import datetime

GENERATION_SECONDS = 300
GENERATION_LEASE_SECONDS = GENERATION_SECONDS + 30
# A pilot repair can ask twice (180 seconds each) and settle three times (10 each).
REPAIR_SECONDS = 390
REPAIR_LEASE_SECONDS = REPAIR_SECONDS + 30


def field(request, name):
    return request.get(name) if isinstance(request, dict) else getattr(request, name, None)


def lease_expired(request, now=None):
    moment = time.time() if now is None else now
    until = field(request, "lease_until")
    if until is None and field(request, "status") == "generating":
        # A reservation's creation time also bounds an incompletely initialized request.
        created = field(request, "created_at")
        try:
            until = datetime.fromisoformat(created).timestamp() + GENERATION_LEASE_SECONDS
        except (TypeError, ValueError):
            return True
    return until is None or until <= moment


def request_blocks_archive(request, now=None):
    status = field(request, "status")
    return status == "ready" or (
        status in {"generating", "repairing"} and not lease_expired(request, now)
    )
