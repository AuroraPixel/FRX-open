"""Server-only SMTP delivery for login codes; secrets never enter account responses.

Configuration is read from FRX_SMTP_CONFIG (default: FRX_DATA_DIR/mail.json), with explicit
environment overrides. Only certificate-verified TLS or STARTTLS is supported.
"""

import json
import logging
import os
import re
import smtplib
import ssl
import threading
from datetime import UTC, datetime
from email.errors import HeaderParseError
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from pathlib import Path

from .card_media import data_dir
from .play_errors import PlayError

logger = logging.getLogger(__name__)
SMTP_SLOTS = threading.BoundedSemaphore(4)
ENVIRONMENT = {
    "host": "FRX_SMTP_HOST", "port": "FRX_SMTP_PORT", "security": "FRX_SMTP_SECURITY",
    "username": "FRX_SMTP_USERNAME", "password": "FRX_SMTP_PASSWORD", "sender": "FRX_SMTP_FROM",
    "code_secret": "FRX_EMAIL_CODE_SECRET",
}


def unavailable():
    return PlayError(503, "email_unavailable", "验证码暂时无法发送，请稍后再试")


def mailbox(value):
    if not isinstance(value, str) or not 3 <= len(value) <= 254 or not value.isascii():
        raise ValueError("Invalid mailbox")
    if any(character.isspace() for character in value):
        raise ValueError("Invalid mailbox")
    try:
        address = Address(addr_spec=value)
    except HeaderParseError:
        raise ValueError("Invalid mailbox") from None
    if not address.username or not address.domain or address.addr_spec != value:
        raise ValueError("Invalid mailbox")
    return value


class SMTPMailer:
    def __init__(self, path=None):
        location = Path(path or os.getenv("FRX_SMTP_CONFIG") or data_dir() / "mail.json")
        try:
            values = json.loads(location.read_text()) if location.exists() else {}
            if not isinstance(values, dict):
                raise ValueError
            for field, name in ENVIRONMENT.items():
                if name in os.environ:
                    values[field] = os.environ[name]
            port = int(values.get("port", 465))
            security = values.get("security", "starttls" if port == 587 else "ssl")
            host = values.get("host", "")
            username, password = values.get("username", ""), values.get("password", "")
            sender, secret = values.get("sender", username), values.get("code_secret", "")
            if not host and not username and not password and not sender and not secret:
                self.configured, self.code_secret = False, ""
                return
            if (not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
                    or not 1 <= port <= 65535 or security not in {"ssl", "starttls"}
                    or not isinstance(username, str) or not username
                    or not isinstance(password, str) or not password
                    or not isinstance(secret, str) or len(secret) < 32):
                raise ValueError
            self._sender = mailbox(sender)
            self._host, self._port, self._security = host, port, security
            self._username, self._password = username, password
            self.code_secret, self.configured = secret, True
        except (OSError, ValueError, TypeError):
            self.configured, self.code_secret = False, ""
            logger.warning("email_configuration_invalid")

    def send_code(self, recipient, code):
        """Deliver one code or report an unavailable service without leaking SMTP details."""
        if not self.configured:
            raise unavailable()
        try:
            recipient = mailbox(recipient)
            if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
                raise ValueError
        except (TypeError, ValueError):
            raise PlayError(422, "invalid_input", "邮箱或验证码格式不正确") from None
        if not SMTP_SLOTS.acquire(blocking=False):
            raise unavailable()
        try:
            context = ssl.create_default_context()
            message = EmailMessage()
            message["From"] = Address(display_name="FRX 草根修行", addr_spec=self._sender)
            message["To"] = recipient
            message["Subject"] = "FRX 登录验证码"
            message["Date"] = format_datetime(datetime.now(UTC))
            message["Message-ID"] = make_msgid(domain=self._sender.rsplit("@", 1)[1])
            message.set_content(
                f"你的 FRX 登录验证码是：{code}\n\n"
                "验证码 10 分钟内有效，仅可使用一次。新邮箱验证成功后会自动注册。\n"
                "请勿向他人提供验证码；如果不是你本人操作，请忽略本邮件。\n"
            )
            if self._security == "ssl":
                connection = smtplib.SMTP_SSL(
                    self._host, self._port, timeout=15, context=context,
                )
            else:
                connection = smtplib.SMTP(self._host, self._port, timeout=15)
            with connection as smtp:
                smtp.ehlo()
                if self._security == "starttls":
                    smtp.starttls(context=context)
                    smtp.ehlo()
                smtp.login(self._username, self._password)
                refused = smtp.send_message(
                    message, from_addr=self._sender, to_addrs=[recipient],
                )
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
        except (OSError, smtplib.SMTPException, ValueError):
            logger.warning("email_delivery_failed")
            raise unavailable() from None
        finally:
            SMTP_SLOTS.release()
