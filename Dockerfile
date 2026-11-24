# syntax=docker/dockerfile:1
# The image holds what runs and nothing more (plan item 72, checked by tests/test_image.py): the
# server (apps/api/frx) and its runtime packages, the engine (apps/engine) and Node, the new
# interface's build (apps/play-web/dist) and runtime art (apps/play-web/assets), the rules data
# (content) and the licences. The interface's sources, docs, tests, tools, art originals, env
# files, source maps and the build tools stay out; .dockerignore keeps most of them out of the
# build context altogether.

FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY apps/play-web/package.json apps/play-web/package-lock.json apps/play-web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix apps/play-web --no-audit --no-fund
# The interface reads two files from outside its folder: the licence list shown in 设置 · 关于
# and the bestiary's species rules.
COPY THIRD-PARTY-NOTICES.md ./
COPY content/art/species.json content/art/
COPY apps/play-web apps/play-web
RUN npm --prefix apps/play-web run build

# The runtime packages from the lock, without the dev group; uv itself stays in this stage.
FROM python:3.13-slim-bookworm AS server
COPY --from=ghcr.io/astral-sh/uv:0.10.6 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

FROM python:3.13-slim-bookworm
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend /usr/local/LICENSE /usr/local/share/doc/node/LICENSE
RUN apt-get update && \
    apt-get install -y --no-install-recommends libstdc++6 && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --create-home --uid 10001 frx && \
    mkdir /data && chown frx:frx /data
WORKDIR /app
# frx runs from its source folder, so ROOT (frx.domain) is /app, beside the engine, the
# interface and the rules data.
ENV PYTHONUNBUFFERED=1 FRX_DATA_DIR=/data PYTHONPATH=/app/apps/api \
    PATH="/app/.venv/bin:$PATH"
COPY --from=server /app/.venv .venv
COPY LICENSE THIRD-PARTY-NOTICES.md ./
COPY content content
COPY apps/engine apps/engine
COPY apps/play-web/assets apps/play-web/assets
COPY --from=frontend /build/apps/play-web/dist apps/play-web/dist
COPY apps/api apps/api
USER frx
EXPOSE 8787
CMD ["uvicorn", "frx.main:app", "--host", "0.0.0.0", "--port", "8787"]
