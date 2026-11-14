"""Private deployment-owner commands. Never accept passwords as arguments."""
from __future__ import annotations

import argparse
from getpass import getpass
import re

from sqlalchemy import func, select

from .database import Base, SessionLocal, engine
from .models import AuditEvent, AuthSession, User, UserIdentity, UserProfile
from .security import hash_password, utcnow


def validate_password(password: str) -> None:
    if len(password) < 14 or len(password) > 128:
        raise ValueError("Use 14–128 characters")
    checks = [r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9]"]
    if not all(re.search(pattern, password) for pattern in checks):
        raise ValueError("Include lowercase, uppercase, number and symbol characters")


def prompt_credentials() -> tuple[str, str]:
    email = input("Administrator email: ").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Enter a valid administrator email address")
    password = getpass("Administrator password: ")
    validate_password(password)
    if password != getpass("Confirm password: "):
        raise ValueError("Passwords do not match")
    return email, password


def create_initial_admin(email: str, password: str) -> str:
    validate_password(password)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(User).where(User.role == "admin")):
            raise ValueError("Initial administrator already exists; use the audited administrator workflow")
        if db.scalar(select(User).where(User.email == email)):
            raise ValueError("An account with that email already exists")
        user = User(email=email, password_hash=hash_password(password), role="admin", status="active")
        db.add(user)
        db.flush()
        db.add(UserProfile(user_id=user.id, display_name="Administrator"))
        db.add(UserIdentity(user_id=user.id))
        db.add(AuditEvent(user_id=user.id, action="initial_administrator_bootstrapped"))
        db.commit()
        return user.id


def reset_admin_password(email: str, password: str) -> None:
    validate_password(password)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email, User.role == "admin"))
        if not user:
            raise ValueError("Active administrator account not found")
        user.password_hash = hash_password(password)
        user.status = "active"
        for session in db.scalars(select(AuthSession).where(
                AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))):
            session.revoked_at = utcnow()
        db.add(AuditEvent(user_id=user.id, action="server_owner_administrator_password_reset"))
        db.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("create-admin", help="Create the first administrator once")
    commands.add_parser("reset-admin-password", help="Server-owner recovery for an existing administrator")
    args = parser.parse_args(argv)
    try:
        email, password = prompt_credentials()
        if args.command == "create-admin":
            create_initial_admin(email, password)
            print("Administrator account created. Sign in and configure the remaining users from the dashboard.")
        else:
            reset_admin_password(email, password)
            print("Administrator password reset and existing sessions revoked.")
        return 0
    except ValueError as error:
        parser.exit(2, f"Setup refused: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
