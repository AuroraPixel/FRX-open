"""Purpose-specific server model routing; browsers only choose known profiles."""

import json
import os
import tempfile
from pathlib import Path

from fastapi import HTTPException

from .gateway import ModelConfig

PROFILES = {
    "default": "主回合",
    "variables": "变量思考",
    "summary": "总结与记忆",
    "optimization": "正文润色",
    "theater": "日报与小剧场",
    "evolution": "世界与剧情演化",
    "archive": "知识归档",
    "embedding": "向量嵌入",
    "rerank": "检索重排",
}


class CardProfiles:
    def __init__(self, settings):
        self.settings = settings
        self.path = Path(settings.path).with_name("profiles.json")

    def load(self, name):
        if name not in PROFILES:
            raise HTTPException(404, "模型档案不存在")
        base = self.settings.load()
        saved = json.loads(self.path.read_text()) if self.path.is_file() else {}
        model = saved.get(name, {}).get("model") or base.model
        if name == "embedding":
            model = os.getenv(
                "FRX_EMBED_MODEL", saved.get(name, {}).get("model") or "gemini-embedding-2"
            )
        prefix = "FRX_" + name.upper()
        return ModelConfig(
            base_url=os.getenv(prefix + "_API_BASE", base.base_url),
            api_key=os.getenv(prefix + "_API_KEY", base.api_key.get_secret_value()),
            model=os.getenv(prefix + "_MODEL", model),
        )

    def public(self):
        return [
            {
                "id": name,
                "label": label,
                "model": self.load(name).model,
                "configured": bool(self.load(name).model),
                "environment_managed": (name == "default" and "FRX_MODEL" in os.environ)
                or (name == "embedding" and "FRX_EMBED_MODEL" in os.environ)
                or "FRX_" + name.upper() + "_MODEL" in os.environ,
            }
            for name, label in PROFILES.items()
        ]

    def select(self, name, model):
        if name not in PROFILES:
            raise HTTPException(404, "模型档案不存在")
        if (
            (name == "default" and "FRX_MODEL" in os.environ)
            or (name == "embedding" and "FRX_EMBED_MODEL" in os.environ)
            or "FRX_" + name.upper() + "_MODEL" in os.environ
        ):
            raise HTTPException(409, "该档案由本机环境配置管理")
        ModelConfig(model=model)
        saved = json.loads(self.path.read_text()) if self.path.is_file() else {}
        saved[name] = {"model": model}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".profiles-")
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(saved, output)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return self.public()
