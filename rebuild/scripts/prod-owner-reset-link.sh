#!/usr/bin/env bash
# Operator password recovery while mail is not configured. Issues ONE reset link
# (30 minutes, single use) for the given account through the same email_tokens path as
# /password-recovery, audited in root_activities. The link is printed only to the
# operator's terminal; do not paste it anywhere else.
# Usage (any directory in the checkout): bash rebuild/scripts/prod-owner-reset-link.sh you@example.com
set -euo pipefail
EMAIL="${1:?usage: prod-owner-reset-link.sh <account email>}"
cd "$(dirname "$0")/.."   # rebuild/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9][0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
ssh -i "$KEY" "$HOST" "RESET_EMAIL='$EMAIL' bash -s" <<'REMOTE'
set -euo pipefail
cd /srv/ms-social-pilot-rebuild/rebuild
cat > ./.reset-link.ts <<'EOF'
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/server/data";
async function main() {
  const email = String(process.env.RESET_EMAIL).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, disabledAt: true } });
  if (!user || user.disabledAt) throw new Error("account not found or disabled");
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const now = new Date();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM email_tokens WHERE "userId" = ${user.id} AND purpose = 'reset'`;
    await tx.$executeRaw`INSERT INTO email_tokens (id, "userId", purpose, "tokenHash", "expiresAt", "usedAt", "createdAt") VALUES (${randomUUID()}, ${user.id}, 'reset', ${hash}, ${new Date(now.getTime() + 30 * 60_000)}, NULL, ${now})`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`recovery_${randomUUID()}`}, ${user.id}, 'account.password_recovery_requested', ${JSON.stringify({ delivery: "operator" })}::jsonb, ${now})`;
  });
  console.log(`\nOpen within 30 minutes (single use):\nhttps://social.newsgeet.com/password-recovery#token=${token}\n`);
}
main().catch(e => { console.log("ERR", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
EOF
chown socialpilot ./.reset-link.ts
set -a; . ./.env.production.local; set +a
sudo -E -u socialpilot RESET_EMAIL="$RESET_EMAIL" node --import tsx ./.reset-link.ts 2>&1 | grep -v '^npm' || true
rm -f ./.reset-link.ts
REMOTE
