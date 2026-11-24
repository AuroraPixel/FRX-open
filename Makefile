.PHONY: setup db build run run-lan play test

# This machine's address on the default route and its Bonjour name (macOS). Override LAN_IP
# elsewhere: make run-lan LAN_IP=192.168.1.20
LAN_IP ?= $(shell ipconfig getifaddr $$(route -n get default 2>/dev/null | awk '/interface:/{print $$2}') 2>/dev/null)
LAN_NAME ?= $(shell scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]').local

setup:
	uv sync --python 3.13
	npm ci --prefix apps/play-web

db:
	docker compose up -d --wait db

build:
	npm --prefix apps/play-web run build

run: db build
	uv run $(if $(wildcard .env),--env-file .env) uvicorn frx.main:app --host 127.0.0.1 --port 8787

# The same server, reachable from other devices on the LAN. Local mode has no login: anyone on
# the network can open the game, change saves and use the configured model, which FRX_LAN=1
# acknowledges (without it the server refuses LAN names). For login, see compose.multiuser.yaml.
run-lan: db build
	@test -n "$(LAN_IP)" || (echo "找不到局域网地址，请用 make run-lan LAN_IP=<本机地址>" && exit 1)
	@echo "局域网地址：http://$(LAN_IP):8787/（没有登录，局域网内谁都能玩）"
	FRX_LAN=1 FRX_ALLOWED_HOSTS=$(LAN_IP),$(LAN_NAME) uv run $(if $(wildcard .env),--env-file .env) uvicorn frx.main:app --host 0.0.0.0 --port 8787

# The new interface's dev server, forwarding /api to an isolated server on FRX_API_PORT (8796).
play:
	npm --prefix apps/play-web run dev

test:
	uv run pytest -q
	npm --prefix apps/play-web test
