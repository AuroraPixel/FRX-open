"""The administrator's commands, straight on the database with the schema owner's role.

    uv run python tools/admin.py --url URL <command> ...       (python -m frx.admin in the image)

    create-admin NAME            a new administrator; the password is typed in the terminal
    claim-local NAME             give the built-in local player a name and a password: the
                                 saves, settings and memories of local mode are then this
                                 account's, nothing is moved
    invite [--count N] [--days D]
                                 one-time invite codes, valid D days (no expiry without --days)
    users                        every user: role, state, last sign-in, own limits, sessions
    disable NAME / enable NAME   stop or allow an account; disabling ends its sessions
    reset-password NAME          a new password typed in the terminal; every session ends
    set-limit NAME [--cost USD] [--turns N] [--concurrent N] [--saves N] [--save-mb MB]
                   [--image-mb MB] [--clear]
                                 the player's own limits; a value "none" is no limit,
                                 "default" goes back to the server's default, --clear drops all
    usage [--user NAME] [--days D | --since TIME] [--until TIME] [--by-purpose]
                                 model usage per user over a period (default: the last day)
    delete-user NAME --yes [--data-dir DIR]
                                 the account and all its data; files nobody else has go too

The connection is --url or FRX_MIGRATION_URL (the owner's, as in the multi-user deployment);
there is no default, so a command never reaches a database by accident. A password is read from
the terminal twice, or from the first line of standard input when that is not a terminal.
"""

import argparse
import getpass
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, delete, func, select, update
from sqlalchemy.orm import sessionmaker

from .auth import (
    LOCAL_USER_ID,
    InviteRecord,
    SessionRecord,
    ThrottleRecord,
    UserRecord,
    check_password,
    check_username,
    hash_password,
    invite_hash,
    new_invite_code,
    username_key,
)
from .card_media import IMAGE, PAGE, UserFile, data_dir
from .card_store import CardRequest
from .email_login import EmailIdentity, EmailLogin, EmailLoginChallenge
from .play_errors import PlayError
from .play_places import PlaceLookRow
from .save_schema import DOMAIN_MODELS
from .storage import now
from .usage import MB, UsageEvent, _number

FOLDERS = {IMAGE: "media", PAGE: "sandbox"}
LIMIT_OPTIONS = {
    "cost": ("cost", float),
    "turns": ("turns", int),
    "concurrent": ("concurrent", int),
    "saves": ("saves", int),
    "save_mb": ("save_bytes", MB),
    "image_mb": ("image_bytes", MB),
}


class AdminError(Exception):
    """A command that cannot be done; the message says why, in the owner's words."""


def stamp(seconds):
    return datetime.fromtimestamp(seconds, UTC).strftime("%Y-%m-%d %H:%M") if seconds else "—"


def moment(text):
    """Seconds since the epoch from an ISO date or time (UTC when no zone is given)."""
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.timestamp()


class Admin:
    def __init__(self, engine, data_dir=None):
        self.engine = engine
        self.sessions = sessionmaker(engine, expire_on_commit=False)
        self.data_dir = Path(data_dir) if data_dir else None
        self.clock = time.time

    def check_schema(self):
        from .migrate import HEAD, schema_state

        with self.engine.connect() as connection:
            state = schema_state(connection)
        if state != HEAD:
            raise AdminError(
                f"表结构是 {state}，不是最新的 {HEAD}：先执行 "
                "python -m frx.migrate upgrade --url <连接串>，或启动一次服务"
            )

    def find(self, session, name):
        key = username_key(name)
        row = session.scalar(select(UserRecord).where(UserRecord.username_key == key))
        if row is None:
            raise AdminError(f"没有用户 {name}")
        return row

    @staticmethod
    def checked(name, password):
        """(name, key) for a new name with its password, by the rules of registration."""
        try:
            name, key = check_username(name)
            check_password(password, name)
        except PlayError as error:
            raise AdminError(error.message) from None
        return name, key

    @staticmethod
    def checked_password(password, name):
        try:
            check_password(password, name)
        except PlayError as error:
            raise AdminError(error.message) from None

    # ------------------------------------------------------------ accounts

    def create_admin(self, name, password):
        name, key = self.checked(name, password)
        hashed = hash_password(password)
        with self.sessions.begin() as session:
            if session.scalar(select(UserRecord.id).where(UserRecord.username_key == key)):
                raise AdminError(f"用户名 {name} 已经有人用了")
            from uuid import uuid4

            session.add(UserRecord(id=str(uuid4()), username=name, username_key=key,
                                   password_hash=hashed, role="admin", status="active",
                                   limits=None, created_at=now()))
        return name

    def claim_local(self, name, password):
        name, key = self.checked(name, password)
        hashed = hash_password(password)
        with self.sessions.begin() as session:
            local = session.get(UserRecord, LOCAL_USER_ID)
            if local is None:
                raise AdminError("库里没有内置的本机用户")
            if local.password_hash:
                raise AdminError(f"本机用户已认领为 {local.username}；改密码请用 reset-password")
            taken = session.scalar(select(UserRecord.id).where(UserRecord.username_key == key))
            if taken and taken != LOCAL_USER_ID:
                raise AdminError(f"用户名 {name} 已经有人用了")
            local.username, local.username_key, local.password_hash = name, key, hashed
        return name

    def invite(self, count=1, days=None):
        if not 1 <= count <= 1000:
            raise AdminError("一次生成 1 到 1000 个邀请码")
        expires = self.clock() + days * 86400 if days else None
        codes = [new_invite_code() for _ in range(count)]
        with self.sessions.begin() as session:
            for code in codes:
                session.add(InviteRecord(code_hash=invite_hash(code), created_at=self.clock(),
                                         expires_at=expires))
        return codes, expires

    def users(self):
        with self.sessions() as session:
            sessions = dict(session.execute(
                select(SessionRecord.user_id, func.count())
                .where(SessionRecord.expires_at > self.clock())
                .group_by(SessionRecord.user_id)
            ).all())
            rows = session.scalars(select(UserRecord).order_by(UserRecord.created_at)).all()
            return [
                {
                    "username": row.username,
                    "role": row.role,
                    "status": row.status,
                    "claimed": row.id != LOCAL_USER_ID or bool(row.password_hash),
                    "local": row.id == LOCAL_USER_ID,
                    "created_at": row.created_at,
                    "last_login_at": row.last_login_at,
                    "limits": row.limits,
                    "sessions": sessions.get(row.id, 0),
                }
                for row in rows
            ]

    def set_status(self, name, status):
        with self.sessions.begin() as session:
            row = self.find(session, name)
            row.status = status
            if status != "active":
                session.execute(delete(SessionRecord).where(SessionRecord.user_id == row.id))
            return row.username

    def disable(self, name):
        return self.set_status(name, "disabled")

    def enable(self, name):
        return self.set_status(name, "active")

    def reset_password(self, name, password):
        with self.sessions() as session:
            row = self.find(session, name)
        self.checked_password(password, row.username)
        hashed = hash_password(password)
        with self.sessions.begin() as session:
            row = self.find(session, name)
            row.password_hash = hashed
            session.execute(delete(SessionRecord).where(SessionRecord.user_id == row.id))
            session.execute(delete(ThrottleRecord).where(
                ThrottleRecord.key == "name:" + row.username_key))
            return row.username

    def set_limit(self, name, changes, clear=False):
        """changes: field -> number, None (no limit) or "default" (the server's default)."""
        with self.sessions.begin() as session:
            row = self.find(session, name)
            own = {} if clear else dict(row.limits or {})
            for field, value in changes.items():
                if value == "default":
                    own.pop(field, None)
                else:
                    own[field] = value
            row.limits = own or None
            return row.username, row.limits

    # ------------------------------------------------------------ usage

    def usage(self, since, until=None, name=None, by_purpose=False):
        until = until or self.clock()
        with self.sessions() as session:
            names = dict(session.execute(select(UserRecord.id, UserRecord.username)).all())
            query = (
                select(UsageEvent.user_id, UsageEvent.purpose, func.sum(UsageEvent.calls),
                       func.sum(UsageEvent.input_tokens), func.sum(UsageEvent.output_tokens),
                       func.sum(UsageEvent.cost), func.count(), func.count(UsageEvent.cost))
                .where(UsageEvent.at > since, UsageEvent.at <= until)
                .group_by(UsageEvent.user_id, UsageEvent.purpose)
            )
            if name:
                query = query.where(UsageEvent.user_id == self.find(session, name).id)
            rows = session.execute(query).all()
        lines = {}
        for user_id, purpose, calls, tokens_in, tokens_out, cost, events, priced in rows:
            key = (names.get(user_id, user_id), purpose if by_purpose else "")
            line = lines.setdefault(key, {"user": key[0], "purpose": key[1], "calls": 0,
                                          "input_tokens": 0, "output_tokens": 0, "cost": 0.0,
                                          "turns": 0, "events": 0, "priced": 0})
            line["calls"] += int(calls or 0)
            line["input_tokens"] += int(tokens_in or 0)
            line["output_tokens"] += int(tokens_out or 0)
            line["cost"] += float(cost or 0)
            line["events"] += int(events)
            line["priced"] += int(priced)
            if purpose == "turn":
                line["turns"] += int(events)
        # A model service that reports no cost is not a free one (the account section says so
        # too): no cost at all when none of the line's events had one, and whether all had.
        for line in lines.values():
            priced, events = line.pop("priced"), line.pop("events")
            line["cost_reported"] = priced == events
            if not priced:
                line["cost"] = None
        return sorted(lines.values(), key=lambda line: (line["user"], line["purpose"]))

    # ------------------------------------------------------------ deleting an account

    def delete_user(self, name):
        """Delete the account and everything of it; the files that no other user has go from
        the data folder too. Returns what was removed."""
        with self.sessions.begin() as session:
            row = self.find(session, name)
            if row.id == LOCAL_USER_ID:
                raise AdminError("内置的本机用户不能删除（本机模式要用它）")
            user_id = row.id
            identity = session.get(EmailIdentity, user_id)
            if identity is not None:
                EmailLogin.lock(session, identity.email)
                session.execute(delete(EmailLoginChallenge).where(
                    EmailLoginChallenge.email == identity.email))
            files = session.execute(
                select(UserFile.kind, UserFile.name).where(UserFile.user_id == user_id)
            ).all()
            counts = {}
            # Dependent domain rows first; explicit order also works without cascades on users.
            for table in (EmailIdentity, CardRequest, PlaceLookRow, *reversed(DOMAIN_MODELS),
                          UserFile, UsageEvent, SessionRecord):
                counts[table.__tablename__] = session.execute(
                    delete(table).where(table.user_id == user_id)
                ).rowcount
            session.execute(update(InviteRecord).where(InviteRecord.created_by == user_id)
                            .values(created_by=None))
            session.execute(update(InviteRecord).where(InviteRecord.used_by == user_id)
                            .values(used_by=None))
            session.execute(delete(ThrottleRecord).where(
                ThrottleRecord.key == "name:" + row.username_key))
            session.delete(row)
            session.flush()
            still = {
                (kind, file) for kind, file in session.execute(
                    select(UserFile.kind, UserFile.name).where(
                        UserFile.name.in_([file for _, file in files] or [""]))
                ).all()
            }
        removed = []
        directory = self.data_dir or data_dir()
        for kind, file in files:
            if (kind, file) in still:
                continue
            path = directory / FOLDERS.get(kind, "media") / file
            if path.is_file():
                path.unlink()
                removed.append(path.name)
        return {"user": row.username, "rows": counts, "files": removed}


# ---------------------------------------------------------------- the command line


def read_password(prompt="密码："):
    if not sys.stdin.isatty():
        line = sys.stdin.readline()
        return line.rstrip("\r\n")
    first = getpass.getpass(prompt)
    if getpass.getpass("再输入一次：") != first:
        raise AdminError("两次输入的密码不一样")
    return first


def limit_value(text, unit):
    if text.strip().lower() == "default":
        return "default"
    try:
        return _number(text, unit)
    except ValueError:
        raise AdminError(
            f"限额 {text} 不对：写非负的数、none（不设限）或 default（用默认值）"
        ) from None


def parser():
    top = argparse.ArgumentParser(prog="python -m frx.admin", description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    top.add_argument("--url", help="数据库连接串（属主角色）；不写时用 FRX_MIGRATION_URL")
    top.add_argument("--data-dir", help="数据目录（图片和生成页面），默认取 FRX_DATA_DIR")
    commands = top.add_subparsers(dest="command", required=True)
    for name in ("create-admin", "claim-local", "disable", "enable", "reset-password"):
        commands.add_parser(name).add_argument("name")
    invite = commands.add_parser("invite")
    invite.add_argument("--count", type=int, default=1)
    invite.add_argument("--days", type=float)
    commands.add_parser("users").add_argument("--json", action="store_true")
    limit = commands.add_parser("set-limit")
    limit.add_argument("name")
    for option in LIMIT_OPTIONS:
        limit.add_argument("--" + option.replace("_", "-"))
    limit.add_argument("--clear", action="store_true")
    usage = commands.add_parser("usage")
    usage.add_argument("--user")
    usage.add_argument("--days", type=float, default=1)
    usage.add_argument("--since")
    usage.add_argument("--until")
    usage.add_argument("--by-purpose", action="store_true")
    usage.add_argument("--json", action="store_true")
    remove = commands.add_parser("delete-user")
    remove.add_argument("name")
    remove.add_argument("--yes", action="store_true", help="确认删除，删除后不能恢复")
    return top


def run(admin, args, out):
    command = args.command
    if command == "create-admin":
        name = admin.create_admin(args.name, read_password())
        print(f"已建管理员 {name}", file=out)
    elif command == "claim-local":
        name = admin.claim_local(args.name, read_password())
        print(f"本机用户已认领为 {name}：原有的存档、设置和记忆都在这个账号下", file=out)
    elif command == "invite":
        codes, expires = admin.invite(args.count, args.days)
        for code in codes:
            print(code, file=out)
        print(f"{len(codes)} 个邀请码，一次性，" + (f"{stamp(expires)}（UTC）前有效" if expires
              else "不过期"), file=sys.stderr)
    elif command == "users":
        users = admin.users()
        if args.json:
            print(json.dumps(users, ensure_ascii=False, indent=2), file=out)
        for user in [] if args.json else users:
            state = "正常" if user["status"] == "active" else "停用"
            if user["local"] and not user["claimed"]:
                state += "（本机用户，未认领）"
            print(f"{user['username']}\t{'管理员' if user['role'] == 'admin' else '玩家'}\t"
                  f"{state}\t最近登录 {user['last_login_at'] or '—'}\t会话 {user['sessions']}"
                  + (f"\t限额 {json.dumps(user['limits'], ensure_ascii=False)}"
                     if user["limits"] else ""), file=out)
    elif command in ("disable", "enable"):
        name = getattr(admin, command)(args.name)
        print(f"{name} 已{'停用，会话全部作废' if command == 'disable' else '恢复'}", file=out)
    elif command == "reset-password":
        name = admin.reset_password(args.name, read_password("新密码："))
        print(f"{name} 的密码已重置，会话全部作废", file=out)
    elif command == "set-limit":
        changes = {}
        for option, (field, unit) in LIMIT_OPTIONS.items():
            value = getattr(args, option)
            if value is not None:
                changes[field] = limit_value(value, unit)
        name, limits = admin.set_limit(args.name, changes, clear=args.clear)
        print(f"{name} 的限额：" + (json.dumps(limits, ensure_ascii=False) if limits
                                   else "全部用默认值"), file=out)
    elif command == "usage":
        until = moment(args.until) if args.until else admin.clock()
        since = moment(args.since) if args.since else until - args.days * 86400
        lines = admin.usage(since, until, args.user, args.by_purpose)
        if args.json:
            print(json.dumps(lines, ensure_ascii=False, indent=2), file=out)
            return
        print(f"{stamp(since)} 到 {stamp(until)}（UTC）", file=out)
        print("用户\t用途\t调用\t输入token\t输出token\t费用(美元)\t主回合", file=out)
        for line in lines:
            cost = ("未报" if line["cost"] is None else f"{line['cost']:.4f}"
                    + ("" if line["cost_reported"] else "（部分未报）"))
            print(f"{line['user']}\t{line['purpose'] or '全部'}\t{line['calls']}\t"
                  f"{line['input_tokens']}\t{line['output_tokens']}\t{cost}\t"
                  f"{line['turns']}", file=out)
    elif command == "delete-user":
        if not args.yes:
            raise AdminError("删除账号会删掉他的全部存档和数据，不能恢复；确认请加 --yes")
        done = admin.delete_user(args.name)
        rows = "，".join(f"{table} {count} 行" for table, count in done["rows"].items())
        print(f"已删除 {done['user']}：{rows}；文件 {len(done['files'])} 个", file=out)


def main(argv=None, out=None):
    out = out or sys.stdout
    args = parser().parse_args(argv)
    url = args.url or os.getenv("FRX_MIGRATION_URL")
    if not url:
        print("需要 --url（或 FRX_MIGRATION_URL）：用数据库属主的连接串", file=sys.stderr)
        return 2
    engine = create_engine(url)
    try:
        admin = Admin(engine, args.data_dir)
        admin.check_schema()
        run(admin, args, out)
    except AdminError as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
