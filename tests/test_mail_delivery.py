"""TLS-only mail transport, server-only configuration and sanitized failures."""

import json
import smtplib
import ssl

import pytest
from frx import mail_delivery as mail
from frx.play_errors import PlayError


@pytest.fixture
def settings(tmp_path, monkeypatch):
    for name in mail.ENVIRONMENT.values():
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / "mail.json"
    values = {"host": "smtp.example.com", "port": 465, "security": "ssl",
              "username": "sender@example.com", "sender": "sender@example.com",
              "password": "test-only-password", "code_secret": "test-only-secret" * 4}
    path.write_text(json.dumps(values))
    return path, values


class Transport:
    def __init__(self, events, failure=None):
        self.events, self.failure = events, failure
        self.message = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def ehlo(self):
        self.events.append("ehlo")

    def starttls(self, *, context):
        assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
        self.events.append("tls")

    def login(self, username, password):
        self.events.append("login")
        if self.failure:
            raise self.failure

    def send_message(self, message, *, from_addr, to_addrs):
        self.events.append("send")
        self.message = message
        assert from_addr == "sender@example.com" and to_addrs == ["player@example.com"]
        return {}


@pytest.mark.parametrize("security", ["ssl", "starttls"])
def test_mail_is_encrypted_before_authentication_and_contains_only_the_one_code(
    settings, monkeypatch, security,
):
    path, values = settings
    values.update(port=465 if security == "ssl" else 587, security=security)
    path.write_text(json.dumps(values))
    events = []
    transport = Transport(events)

    def connect(host, port, *, timeout, context=None):
        assert host == values["host"] and port == values["port"] and timeout == 15
        if security == "ssl":
            assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
            events.append("tls")
        return transport

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL" if security == "ssl" else "SMTP", connect)
    mailer = mail.SMTPMailer(path)
    assert mailer.configured
    mailer.send_code("player@example.com", "123456")
    assert events == (["tls", "ehlo", "login", "send"] if security == "ssl"
                      else ["ehlo", "tls", "ehlo", "login", "send"])
    message = transport.message
    assert message["To"] == "player@example.com"
    assert "123456" in message.get_content() and "10 分钟" in message.get_content()
    assert values["password"] not in message.as_string()
    assert values["code_secret"] not in message.as_string()


def test_smtp_errors_do_not_reveal_credentials_or_codes(settings, monkeypatch, caplog):
    path, values = settings
    failure = smtplib.SMTPAuthenticationError(535, values["password"].encode())
    transport = Transport([], failure)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", lambda *a, **kw: transport)
    with pytest.raises(PlayError) as error:
        mail.SMTPMailer(path).send_code("player@example.com", "123456")
    assert error.value.status == 503 and error.value.code == "email_unavailable"
    assert values["password"] not in str(error.value) + caplog.text
    assert "123456" not in str(error.value) + caplog.text
    assert transport.message is None


def test_unverified_tls_does_not_fall_back_to_plain_smtp(settings, monkeypatch):
    path, _ = settings

    def reject(*args, **kwargs):
        raise ssl.SSLCertVerificationError("certificate rejected")

    def forbidden(*args, **kwargs):
        pytest.fail("No plaintext fallback is permitted")

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", reject)
    monkeypatch.setattr(mail.smtplib, "SMTP", forbidden)
    with pytest.raises(PlayError) as error:
        mail.SMTPMailer(path).send_code("player@example.com", "123456")
    assert error.value.code == "email_unavailable"


@pytest.mark.parametrize("field,value", [
    ("security", "plain"), ("code_secret", "short"), ("password", ""),
    ("sender", "sender@example.com\r\nBcc: unwanted@example.com"),
    ("sender", "alice@"), ("sender", "alice@@example.com"),
    ("sender", "alice@example..com"),
])
def test_partial_or_unsafe_configuration_is_not_enabled(settings, field, value):
    path, values = settings
    values[field] = value
    path.write_text(json.dumps(values))
    assert not mail.SMTPMailer(path).configured


def test_environment_overrides_private_configuration(settings, monkeypatch):
    path, _ = settings
    monkeypatch.setenv("FRX_EMAIL_CODE_SECRET", "a-different-test-only-secret" * 2)
    mailer = mail.SMTPMailer(path)
    assert mailer.configured
    assert mailer.code_secret == "a-different-test-only-secret" * 2


def test_bad_recipient_or_code_never_opens_a_connection(settings, monkeypatch):
    path, _ = settings

    def forbidden(*args, **kwargs):
        pytest.fail("Invalid input must not reach SMTP")

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", forbidden)
    mailer = mail.SMTPMailer(path)
    for recipient, code in (("a@example.com\nBcc: b@example.com", "123456"),
                            ("alice@", "123456"),
                            ("player@example.com", "12345x")):
        with pytest.raises(PlayError) as error:
            mailer.send_code(recipient, code)
        assert error.value.status == 422
