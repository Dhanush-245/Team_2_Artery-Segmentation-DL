"""Create a private local Compose configuration without printing its secret."""
from pathlib import Path
import os
import secrets

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / '.env'
if target.exists():
    raise SystemExit('.env already exists; it was not changed')
content = (
    '# Generated private local configuration. Never commit this file.\n'
    f'JWT_SECRET={secrets.token_urlsafe(48)}\n'
    'COROVISION_PORT=8000\n'
    'CORS_ORIGINS=http://127.0.0.1:8000\n'
    'CV_LOCAL_DEMO_SESSIONS=0\n'
    'CV_LOCAL_DEMO_SHARING=0\n'
)
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as stream:
    stream.write(content)
print('Created private .env with a generated JWT secret (value not displayed).')
