# 云汀修行录 · FRX Open

可以自行部署的中文修仙文字 RPG。玩家写下行动或选择行动卡。剧情由你配置的语言模型续写，骰子、斗法、修炼、历法、任务和交易由结算引擎处理。内置示例世界「云汀」有渡口、集市和宗门。筑基后期可以查古阵或搭商路去落灯海，完成护航、采药和猎妖委托，探索候潮石窟与照海台。

- `apps/play-web/` 是 React 界面和 three.js 舞台。
- `apps/api/frx/` 提供账号、存档、回合和模型接口。
- `apps/engine/` 是 Node.js 结算引擎。
- `content/` 包含地图、出身、宗门、物品、世界书和规则数值。

## 在本机运行

需要 Python 3.13、[uv](https://docs.astral.sh/uv/) 和 Node.js 22。以下使用 SQLite 和单人模式，监听本地回环地址。

```sh
make setup
make build
cp .env.example .env
mkdir -p .frx
FRX_DATABASE_URL="sqlite:///$PWD/.frx/play.db" FRX_DATA_DIR="$PWD/.frx" \
  uv run --env-file .env uvicorn frx.main:app --host 127.0.0.1 --port 8796
```

打开 [本地游戏](http://127.0.0.1:8796/play/)。在设置里配置自己的 OpenAI 兼容模型，或在 `.env` 中设置 `FRX_API_BASE`、`FRX_MODEL`、`FRX_API_KEY` 后重启。建档前，在项目目录运行工具准入检查，确认模型支持引擎调用。

```
FRX_DATA_DIR="$PWD/.frx" uv run --env-file .env python -m frx.tool_admission
```

测试可用 [本地假模型](tests/mock_provider.py)，它只监听回环地址。

## 多人部署

`compose.multiuser.yaml` 提供 Caddy、PostgreSQL 和开启账号模式的服务。先复制 `deploy/multiuser.env.example` 为 `deploy/multiuser.env`，设置自己的域名和随机数据库密码，并在 `.env` 配置模型。

```sh
docker compose --env-file deploy/multiuser.env -f compose.multiuser.yaml up -d --build
```

首次部署需要空数据库。SMTP 和验证码签名密钥的配置见 [环境变量样板](.env.example)。密钥和存档应保存在本地数据目录或部署环境中。改 DOM、规则或接口后，可以用下列命令检查最小回归。

```sh
uv run pytest -q tests/test_public_world.py tests/test_star_sea.py
npm --prefix apps/play-web test
```

## 许可证

项目代码、原创示例内容及本项目可授权的生成素材采用 [MIT](LICENSE)。运行时内附为 FRX 生成的通用场景和部件，素材来源见 [资产台账](apps/play-web/assets/ledger.json)。第三方依赖及字体遵循各自的许可证，见 [第三方许可](THIRD-PARTY-NOTICES.md)。
