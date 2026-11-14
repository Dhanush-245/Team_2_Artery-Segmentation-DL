"""Compatibility wrapper for the secure interactive bootstrap command."""
from app.cli import main

raise SystemExit(main(["create-admin"]))
