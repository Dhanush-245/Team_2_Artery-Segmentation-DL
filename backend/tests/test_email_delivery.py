"""The SMTP delivery path itself (the reset-flow test stubs it out)."""
import pytest
from fastapi import HTTPException

from app import auth_ext


class FakeSMTP:
    log: list = []

    def __init__(self, host, port, timeout=None):
        FakeSMTP.log.append(("connect", host, port))

    def starttls(self):
        FakeSMTP.log.append(("starttls",))

    def login(self, user, password):
        FakeSMTP.log.append(("login", user))

    def send_message(self, message):
        FakeSMTP.log.append(("send", message["To"], message["Subject"], message.get_content()))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def configure(monkeypatch, port="587"):
    FakeSMTP.log = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.org")
    monkeypatch.setenv("SMTP_PORT", port)
    monkeypatch.setenv("SMTP_FROM", "noreply@example.org")
    monkeypatch.setenv("SMTP_USERNAME", "mailer")
    monkeypatch.setenv("SMTP_PASSWORD", "x")
    monkeypatch.setattr(auth_ext.smtplib, "SMTP", FakeSMTP)


def test_starttls_login_and_message(monkeypatch):
    configure(monkeypatch)
    auth_ext.send_code("a@example.org", "123456", "password reset")
    kinds = [item[0] for item in FakeSMTP.log]
    assert kinds == ["connect", "starttls", "login", "send"]
    _, to, subject, body = FakeSMTP.log[-1]
    assert to == "a@example.org" and "password reset" in subject and "123456" in body and "10 minutes" in body


def test_not_configured_and_failure_are_503(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    with pytest.raises(HTTPException) as err:
        auth_ext.send_code("a@example.org", "123456", "password reset")
    assert err.value.status_code == 503
    configure(monkeypatch)

    def boom(*a, **k):
        raise OSError("down")
    monkeypatch.setattr(auth_ext.smtplib, "SMTP", boom)
    with pytest.raises(HTTPException) as err:
        auth_ext.send_code("a@example.org", "123456", "password reset")
    assert err.value.status_code == 503
