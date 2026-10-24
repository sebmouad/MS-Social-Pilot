# MS Social Pilot (`v1.0.0`)

Modular, multi-workspace social media publishing, engagement inbox, analytics, AI studio, and paid-ads platform.

## Documentation

- [`AGENT.md`](AGENT.md) — Compact architecture, conventions, and operational reference for AI agents and developers.
- [`PLAN.md`](PLAN.md) — `v1.1+` product feature, visual design system, and UX master plan.

## Local Development

```bash
cd app
npm ci
npx prisma generate
npm run typecheck
npm run dev
```

---

## Standard Install & Update Deployment (`app/scripts/deploy.sh`)

[`app/scripts/deploy.sh`](app/scripts/deploy.sh) is a single, zero-hardcoding script that handles **first-time server installation** (Node.js 22, PostgreSQL, system user, database, bootstrap secrets, and `systemd` services), **incremental production updates** (pre-deploy `pg_dump` backup, CPU-capped build, additive SQL migrations, atomic swap, health check, and automatic rollback), and **account recovery**.

### 1. Deploy / Install with an SSH Key

```bash
bash app/scripts/deploy.sh \
  --host 203.0.113.10 \
  --user root \
  --key ~/.ssh/id_ed25519
```

### 2. Deploy / Install with an SSH Password

```bash
bash app/scripts/deploy.sh \
  --host 203.0.113.10 \
  --user root \
  --pass "your-ssh-password"
```

### 3. Deploy Using Environment Variables

```bash
DEPLOY_HOST=203.0.113.10 DEPLOY_USER=root DEPLOY_KEY=~/.ssh/id_ed25519 bash app/scripts/deploy.sh
```

### 4. Direct On-Server Install / Update (No SSH)

When running directly on a Debian/Ubuntu server:

```bash
sudo bash app/scripts/deploy.sh --local
```

### 5. CLI Admin Commands (Root Promotion & 2FA Recovery)

```bash
# Promote a registered user account to Instance Owner (Root):
bash app/scripts/deploy.sh --host 203.0.113.10 --key ~/.ssh/id_ed25519 --set-root you@example.com

# Clear 2FA / passkeys for an account:
bash app/scripts/deploy.sh --host 203.0.113.10 --key ~/.ssh/id_ed25519 --reset-2fa you@example.com
```

### Supported Flags & Defaults

| Flag | Environment Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `--host <ip_or_domain>` | `DEPLOY_HOST` | *(required for SSH)* | Target server IP or hostname |
| `--user <ssh_user>` | `DEPLOY_USER` | `root` | SSH username |
| `--key <path>` | `DEPLOY_KEY` | *(SSH default)* | Path to SSH private key |
| `--pass <password>` | `DEPLOY_PASS` | *(none)* | SSH password (uses OpenSSH `SSH_ASKPASS`) |
| `--port <ssh_port>` | `DEPLOY_PORT` | `22` | SSH port |
| `--app-port <port>` | `APP_PORT` | `3100` | Internal Next.js HTTP port (`127.0.0.1:<port>`) |
| `--local` | — | — | Install or update directly on the local machine |
| `--set-root <email>` | — | — | Grant Root (`isInstanceOwner`) to `<email>` |
| `--reset-2fa <email>` | — | — | Reset TOTP/passkeys and active sessions for `<email>` |
