"""Read-only clean-clone checks. Does not create secrets, users or data."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def command(*parts: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(parts, capture_output=True, text=True, timeout=20, check=False)
        return result.returncode == 0, (result.stdout or result.stderr).strip().splitlines()[0]
    except (OSError, subprocess.TimeoutExpired, IndexError):
        return False, "unavailable"


def main() -> int:
    checks = []
    docker_ok, docker_version = command("docker", "--version")
    compose_ok, compose_version = command("docker", "compose", "version")
    checks.extend([
        {"id": "docker", "ok": docker_ok, "detail": docker_version},
        {"id": "compose", "ok": compose_ok, "detail": compose_version},
        {"id": "environment", "ok": (ROOT / ".env").is_file(),
         "detail": ".env present" if (ROOT / ".env").is_file() else "Copy .env.example to .env and set JWT_SECRET"},
        {"id": "compose_file", "ok": (ROOT / "compose.yaml").is_file(), "detail": "compose.yaml"},
        {"id": "dockerfile", "ok": (ROOT / "Dockerfile").is_file(), "detail": "Dockerfile"},
        {"id": "disk", "ok": shutil.disk_usage(ROOT).free >= 4 * 1024**3,
         "detail": f"{shutil.disk_usage(ROOT).free / 1024**3:.1f} GiB free; 4 GiB minimum for CPU model image"},
    ])
    payload = {"status": "ready" if all(row["ok"] for row in checks) else "action_required",
               "checks": checks, "training_started": False}
    print(json.dumps(payload, indent=2))
    return 0 if payload["status"] == "ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
