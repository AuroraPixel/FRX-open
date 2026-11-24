"""Server-only model credentials and a LiteLLM OpenAI-compatible gateway."""

import json
import logging
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator

from .domain import ROOT, StrictModel

os.environ.setdefault("LITELLM_TELEMETRY", "False")
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
# LiteLLM's DEV mode loads ./.env on import. FRX passes its env file explicitly
# (make run, Compose), and tests must never pick up a real model connection.
os.environ.setdefault("LITELLM_MODE", "PRODUCTION")

logger = logging.getLogger(__name__)


class ModelConfig(StrictModel):
    base_url: str = "https://api.openai.com/v1"
    model: str = ""
    api_key: SecretStr = SecretStr("")

    @field_validator("base_url")
    @classmethod
    def check_url(cls, value):
        parts = urlsplit(value)
        if (
            parts.scheme not in {"https", "http"}
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            raise ValueError("请输入不含用户名、密码或查询参数的HTTP模型地址")
        return value.rstrip("/")

    @field_validator("model")
    @classmethod
    def check_model(cls, value):
        if len(value) > 200:
            raise ValueError("模型名称过长")
        return value


class ModelUpdate(ModelConfig):
    # Blank key preserves a previously saved key; removal must be explicit.
    clear_key: bool = False


class ModelSettings:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv("FRX_DATA_DIR", ROOT / ".frx")) / "model.json"

    def load(self) -> ModelConfig:
        value = json.loads(self.path.read_text()) if self.path.exists() else {}
        for field, env in (
            ("base_url", "FRX_API_BASE"),
            ("model", "FRX_MODEL"),
            ("api_key", "FRX_API_KEY"),
        ):
            if env in os.environ:
                value[field] = os.environ[env]
        return ModelConfig.model_validate(value)

    def public(self) -> dict:
        config = self.load()
        return dict(
            base_url=config.base_url,
            model=config.model,
            configured=bool(config.model),
            key_set=bool(config.api_key.get_secret_value()),
            environment_managed=any(
                k in os.environ for k in ("FRX_API_BASE", "FRX_MODEL", "FRX_API_KEY")
            ),
        )

    def save(self, update: ModelUpdate) -> dict:
        if self.public()["environment_managed"]:
            raise ValueError("模型由环境变量管理，请在启动环境中修改")
        key = update.api_key.get_secret_value() or self.load().api_key.get_secret_value()
        if update.clear_key:
            key = ""
        config = ModelConfig(base_url=update.base_url, model=update.model, api_key=key)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".model-")
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(dict(base_url=config.base_url, model=config.model, api_key=key), output)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return self.public()


class ModelFailure(Exception):
    def __init__(self, message="", *, retryable=False):
        super().__init__(message)
        # A provider-side 5xx or a dropped connection before any output can be tried again.
        self.retryable = retryable


def model_failure(exc: Exception, *, stage: str, started: float, timeout: float) -> ModelFailure:
    from litellm import APIConnectionError, Timeout

    status = getattr(exc, "status_code", None)
    # Provider exceptions may contain credentials, prompts or response bodies.
    # Log only controlled metadata, never the exception text or traceback.
    logger.warning(
        "model_request_failed stage=%s error=%s status=%s elapsed_seconds=%.2f timeout_seconds=%s",
        stage,
        type(exc).__name__,
        status,
        time.monotonic() - started,
        timeout,
    )
    if isinstance(exc, (Timeout, TimeoutError)) or status in {408, 504}:
        message = "模型响应超时，请稍后重试。"
    elif status in {401, 403}:
        message = f"模型服务拒绝访问（HTTP {status}），请检查密钥和模型访问权限。"
    elif status == 429:
        message = "模型服务限流或额度不足（HTTP 429），请稍后重试或检查服务额度。"
    elif isinstance(status, int) and status >= 500:
        message = f"模型服务暂时异常（HTTP {status}），请稍后重试。"
    elif isinstance(exc, APIConnectionError):
        message = "无法连接模型服务，请检查网络和服务地址。"
    elif isinstance(status, int):
        message = f"模型服务拒绝请求（HTTP {status}），请检查地址、模型名称和参数。"
    else:
        message = "模型请求失败，请查看本地服务日志。"
    # Timeouts are left to the caller's own stall budget.
    retryable = not isinstance(exc, (Timeout, TimeoutError)) and (
        (isinstance(status, int) and status >= 500 and status != 504)
        or isinstance(exc, APIConnectionError)
    )
    return ModelFailure(message, retryable=retryable)


class Gateway:
    @staticmethod
    async def complete(config: ModelConfig, messages: list[dict], *, timeout: float = 45, **kwargs):
        from litellm import acompletion

        started = time.monotonic()
        try:
            if config.model.rsplit("/", 1)[-1].casefold().startswith("deepseek"):
                # DeepSeek enables thinking by default and then requires reasoning_content
                # replay across tool rounds. Our runtime keeps content/tool_calls only, so
                # even an explicit thinking option must stay disabled until replay is supported.
                kwargs.pop("thinking", None)
                kwargs["extra_body"] = {
                    **(kwargs.get("extra_body") or {}), "thinking": {"type": "disabled"},
                }
            return await acompletion(
                model=f"openai/{config.model}",
                api_base=config.base_url,
                api_key=config.api_key.get_secret_value() or "local-no-key",
                messages=messages,
                timeout=timeout,
                num_retries=0,
                **kwargs,
            )
        except Exception as exc:
            raise model_failure(
                exc,
                stage="narrative" if kwargs.get("stream") else "extract",
                started=started,
                timeout=timeout,
            ) from None
