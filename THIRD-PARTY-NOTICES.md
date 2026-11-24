# 第三方许可清单

随 FRX 分发的开源部件及其许可证：镜像里的运行环境和服务端的全部 Python 包、结算引擎用的 Node 和收录的数据、浏览器拿到的新界面代码和字体。`tests/test_notices.py` 对照 `uv.lock`、`apps/play-web/package-lock.json`、`Dockerfile` 和字体核对这份清单，`tests/test_image.py` 对照镜像里实际装的包。

许可证全文：Python 包的随包在镜像的 `/app/.venv` 里，CPython 的在 `/usr/local/lib/python3.13/LICENSE.txt`，Node.js 的在 `/usr/local/share/doc/node/LICENSE`，字体的版权说明随字体在 `/play/assets/fonts/LICENSE.txt`；浏览器端的包保留了 React 和 three.js 的许可证注释。镜像的基础 `python:3.13-slim-bookworm` 是 Debian 12，系统包的版权文件在镜像的 `/usr/share/doc/` 下。

## 服务端（Python）

运行环境：

| 部件 | 版本 | 许可证 |
|---|---|---|
| CPython | 3.13 | PSF-2.0 |

直接依赖：

| 部件 | 版本 | 许可证 |
|---|---|---|
| fastapi | 0.143.1 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| sqlalchemy | 2.0.54 | MIT |
| psycopg | 3.3.6 | LGPL-3.0-only（作为未修改的库动态使用） |
| litellm | 1.105.1 | MIT |
| alembic | 1.20.1 | MIT |
| argon2-cffi | 25.1.0 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |

间接依赖，随直接依赖装进镜像（Linux）：

| 部件 | 版本 | 许可证 |
|---|---|---|
| aiohappyeyeballs | 2.7.1 | PSF-2.0 |
| aiohttp | 3.14.5 | Apache-2.0 AND MIT |
| aiosignal | 1.4.0 | Apache-2.0 |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| argon2-cffi-bindings | 26.1.0 | MIT（内含的 Argon2 参考实现为 CC0-1.0 或 Apache-2.0） |
| attrs | 26.1.0 | MIT |
| boto3 | 1.43.114 | Apache-2.0 |
| botocore | 1.43.114 | Apache-2.0 |
| certifi | 2026.7.22 | MPL-2.0 |
| cffi | 2.1.1 | MIT-0 |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| distro | 1.9.0 | Apache-2.0 |
| fastuuid | 0.14.0 | BSD-3-Clause |
| filelock | 3.32.7 | MIT |
| frozenlist | 1.8.0 | Apache-2.0 |
| fsspec | 2026.9.0 | BSD-3-Clause |
| greenlet | 3.5.6 | MIT AND PSF-2.0 |
| h11 | 0.16.0 | MIT |
| h2 | 4.4.1 | MIT |
| hf-xet | 1.7.0 | Apache-2.0 |
| hpack | 4.2.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| huggingface-hub | 1.33.0 | Apache-2.0 |
| hyperframe | 6.1.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| importlib-metadata | 8.9.0 | Apache-2.0 |
| jinja2 | 3.1.6 | BSD-3-Clause |
| jiter | 0.17.0 | MIT |
| jmespath | 1.1.0 | MIT |
| jsonschema | 4.26.0 | MIT |
| jsonschema-specifications | 2025.9.1 | MIT |
| mako | 1.4.3 | MIT |
| markupsafe | 3.0.4 | BSD-3-Clause |
| multidict | 7.1.0 | Apache-2.0 |
| openai | 2.54.0 | Apache-2.0 |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| propcache | 0.5.4 | Apache-2.0 |
| psycopg-binary | 3.3.6 | LGPL-3.0-only（未修改；它附带的 libpq、OpenSSL、Kerberos、OpenLDAP、Cyrus SASL 等共享库各按其许可证） |
| pycparser | 3.12 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic-core | 2.50.1 | MIT |
| pydantic-settings | 2.16.0 | MIT |
| python-dateutil | 2.9.0.post0 | Apache-2.0 AND BSD-3-Clause |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| pyyaml | 6.0.3 | MIT |
| referencing | 0.37.0 | MIT |
| regex | 2026.9.29 | Apache-2.0 AND CNRI-Python |
| requests | 2.34.2 | Apache-2.0 |
| rpds-py | 2026.9.1 | MIT |
| s3transfer | 0.19.2 | Apache-2.0 |
| six | 1.17.0 | MIT |
| sniffio | 1.3.1 | MIT OR Apache-2.0 |
| starlette | 1.8.0 | BSD-3-Clause |
| tiktoken | 0.14.0 | MIT |
| tokenizers | 0.23.3 | Apache-2.0 |
| tqdm | 4.70.1 | MPL-2.0 AND MIT |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| urllib3 | 2.8.0 | MIT |
| yarl | 1.25.1 | Apache-2.0 |
| zipp | 4.1.1 | MIT |

## 结算引擎（Node）

没有第三方 npm 依赖，只用 Node 自带的模块。运行环境和收录的数据：

| 部件 | 版本 | 许可证 |
|---|---|---|
| Node.js | 22 | MIT（内含的 V8、OpenSSL、ICU、libuv 等各按其许可证） |
| HTML 命名字符引用表（html-entities.json） |  | PSF-2.0（取自 Python 标准库的 html.entities.html5，数据出自 WHATWG HTML 标准） |

## 新界面（浏览器）

运行时随页面分发：

| 部件 | 版本 | 许可证 |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| three | 0.149.0 | MIT |
| zustand | 5.0.16 | MIT |

只在开发和构建时使用，不随页面分发：

| 部件 | 版本 | 许可证 |
|---|---|---|
| @testing-library/dom | 10.4.2 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @types/node | 22.20.5 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/three | 0.149.0 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| ajv | 8.20.0 | MIT |
| jsdom | 26.1.0 | MIT |
| json-schema-to-typescript | 15.0.4 | MIT |
| pixelmatch | 7.2.0 | ISC |
| pngjs | 7.0.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| vite | 6.4.4 | MIT |
| vitest | 3.2.7 | MIT |

## 字体

| 字体 | 用途 | 许可证 |
|---|---|---|
| Noto Serif SC（思源宋体），常规与粗体 | 正文 | SIL Open Font License 1.1 |
| Ma Shan Zheng（马善政毛笔楷书） | 标题、名字、印章 | SIL Open Font License 1.1 |

新界面分发的是这两种字体的子集和切片，许可证不变。切片用的原件放在 `tools/fonts/src/`（Google Fonts 当时提供的文件，地址和 SHA-256 记在 `tools/fonts/subset.py`），只在仓库里，不随服务分发。
