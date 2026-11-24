"""Errors of the /api/play routes in the contracts' shape: {"error": {"code", "message"}}.

Raise PlayError anywhere under a play route; main.py turns it into the response. main.py also
answers in this shape whatever else goes wrong under /api/play: a body or query the contract does
not allow (invalid_input), an HTTPException of the older modules beneath the routes (by its
status), a route or method that does not exist (not_found) and anything unexpected
(engine_failed). The message is Chinese and said to the player. `headers` go with the response
(Retry-After for a 429). Each code answers with the one status the contract gives it (STATUS);
tests/test_play_errors.py holds the routes, the raises and the contract to it."""

from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import play_models
from .play_models import ErrorBody, ErrorDetail

# What pydantic writes into an error's place for the member of a union it tried (「verb.Verb.kind」,
# 「queue.list[QueueItem].0.kind」): the player is told the fields only.
UNION_MEMBERS = {
    name for name, value in vars(play_models).items()
    if isinstance(value, type) and issubclass(value, BaseModel)
}

# The status of each code (docs/play-contracts.md, 出错). cancelled is only ever the last event of
# a turn's stream, never a response.
STATUS = {
    "version_conflict": 409,
    "turn_in_progress": 409,
    "pending_settlement": 409,
    "not_found": 404,
    "unauthorized": 401,
    "quota_exceeded": 429,
    "input_too_large": 413,
    "model_not_configured": 400,
    "model_failed": 502,
    "email_unavailable": 503,
    "engine_failed": 500,
    "refused": 422,
    "forbidden": 403,
    "busy": 429,
    "too_many_attempts": 429,
    "invalid_input": 422,
}


class PlayError(Exception):
    def __init__(self, status, code, message, headers=None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.headers = headers


def not_found(message="存档不存在"):
    return PlayError(404, "not_found", message)


def refused(message):
    """The rules refuse the player's choice: a creation step, a panel action, a portrait the
    kit cannot draw. The message says why, as the old page said it."""
    return PlayError(422, "refused", message)


def invalid_input(message):
    return PlayError(422, "invalid_input", message)


def conflict_code(message):
    """The code of a 409 from the older modules, which say what kind of conflict it is only in
    their words: a turn waiting for its settlement, the save changed or gone back meanwhile, or
    else a turn under way."""
    if "待结算" in message:
        return "pending_settlement"
    if "变化" in message or "回溯" in message or "过期" in message:
        return "version_conflict"
    return "turn_in_progress"


# The code an HTTPException of the older modules stands for, by its status. Their 422s refuse
# what was sent (a file that is not a save, a damaged backup); a method a path does not have is a
# route that does not exist.
BY_STATUS = {
    400: "model_not_configured",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "not_found",
    413: "input_too_large",
    422: "refused",
    429: "busy",
    502: "model_failed",
}


def from_http(exc):
    """An HTTPException (the older modules', or Starlette's for a route that does not exist) as
    the contract's error."""
    detail = exc.detail
    if isinstance(detail, dict):
        detail = detail.get("message")
    detail = detail if isinstance(detail, str) else ""
    headers = getattr(exc, "headers", None)
    if exc.status_code == 409:
        code = conflict_code(detail)
    else:
        code = BY_STATUS.get(exc.status_code, "engine_failed")
    if exc.status_code in (404, 405) and detail in ("Not Found", "Method Not Allowed"):
        # Starlette's own: no route has this path, or none answers this method on it
        detail, headers = "没有这个接口", None
    return PlayError(STATUS[code], code, detail or "服务端出了错，请稍后重试", headers)


def request_problem(errors):
    """invalid_input for a request the contract does not allow (FastAPI's validation `errors`),
    saying in Chinese what is wrong with the first thing wrong; FastAPI's own words are
    English."""
    first = errors[0] if errors else {}
    kind = str(first.get("type", ""))
    where = [
        str(part) for part in first.get("loc", ())
        if part not in ("body", "query", "path")
        and not (isinstance(part, str) and ("[" in part or part in UNION_MEMBERS))
    ]
    field = "「" + ".".join(where) + "」" if where else ""
    if kind == "json_invalid":
        return invalid_input("请求的内容不是有效的 JSON")
    if kind == "contract_rule":
        # a rule of the contract across fields (TurnRequest's one way a turn goes), in Chinese
        return invalid_input(str(first.get("msg") or "请求的格式不对"))
    if not field:
        return invalid_input("请求缺少内容" if kind == "missing" else "请求的格式不对")
    if kind == "missing":
        return invalid_input(f"请求缺少{field}")
    if kind.endswith("too_long"):
        return invalid_input(f"{field}太长了")
    if kind.endswith("too_short"):
        return invalid_input(f"{field}太短了")
    if kind.startswith(("greater_than", "less_than")):
        return invalid_input(f"{field}超出了范围")
    if kind in ("literal_error", "enum"):
        return invalid_input(f"{field}不是可选的值")
    if kind == "extra_forbidden":
        return invalid_input(f"请求里有不认识的{field}")
    return invalid_input(f"{field}的格式不对")


def error_body(code, message):
    return ErrorBody(error=ErrorDetail(code=code, message=message)).wire()


async def play_error_response(request, error: PlayError):
    return JSONResponse(
        error_body(error.code, error.message),
        status_code=error.status,
        headers=getattr(error, "headers", None),
    )
