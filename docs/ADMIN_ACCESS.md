# Initial administrator access

CoroVision AI has no default administrator password. Each installation creates its own first administrator in a private server terminal.

## First deployment

Run the interactive command inside the deployed application container:

```bash
python -m app.cli create-admin
```

With Docker Compose:

```bash
docker compose exec app python -m app.cli create-admin
```

With a Railway shell:

```bash
railway ssh -- python -m app.cli create-admin
```

The command prompts for an email and password without accepting the password in command-line arguments or environment variables. Passwords require 14–128 characters with uppercase, lowercase, number and symbol characters. The command refuses to run after an administrator exists. Public registration always creates a viewer account; it cannot create an administrator.

Additional roles are assigned through the authenticated Administrator workspace and are audited. There is no shared credential between installations.

## Server-owner recovery

An authenticated deployment owner with private container access can run:

```bash
python -m app.cli reset-admin-password
```

The command prompts securely, only resets an existing administrator, revokes that administrator's sessions and writes an audit event. It is not exposed as a public API.

## Current authentication boundary

The application supports hashed passwords, login throttling, eight-hour revocable sessions, logout, password-reset delivery when SMTP is configured, account suspension and OAuth when configured. MFA enrollment is not currently implemented; do not claim MFA protection until a separately tested factor-enrollment and recovery workflow is added.
