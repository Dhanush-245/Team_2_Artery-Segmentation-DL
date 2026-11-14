import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import cli
from app.database import Base
from app.models import AuditEvent, AuthSession, User
from app.security import session_expiry


def isolated_cli(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path/'bootstrap.db'}")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(cli, "engine", engine)
    monkeypatch.setattr(cli, "SessionLocal", sessions)
    return sessions


def test_initial_admin_is_one_time_and_recovery_revokes_sessions(tmp_path, monkeypatch):
    sessions = isolated_cli(tmp_path, monkeypatch)
    password = "Strong-Test-Password-42!"
    user_id = cli.create_initial_admin("owner@example.org", password)
    with sessions() as db:
        user = db.get(User, user_id)
        assert user.email == "owner@example.org" and user.role == "admin" and user.status == "active"
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "initial_administrator_bootstrapped"))
        db.add(AuthSession(user_id=user.id, expires_at=session_expiry()))
        db.commit()
    with pytest.raises(ValueError, match="already exists"):
        cli.create_initial_admin("other@example.org", password)
    cli.reset_admin_password("owner@example.org", "Different-Strong-Password-43!")
    with sessions() as db:
        assert db.scalar(select(AuthSession)).revoked_at is not None
        assert db.scalar(select(AuditEvent).where(
            AuditEvent.action == "server_owner_administrator_password_reset"))


@pytest.mark.parametrize("password", ["short", "alllowercasepassword", "NoSymbolPassword42"])
def test_admin_password_policy_rejects_weak_passwords(password):
    with pytest.raises(ValueError):
        cli.validate_password(password)
