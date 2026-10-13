---
name: deploy-production
description: Deploy MS Social Pilot to production (social.newsgeet.com) safely, or roll back. Use whenever changes are committed and tests pass, or when the owner says deploy.
---

# Deploy to production

Full detail: `docs/OPERATIONS.md`.

1. Tests green (`run-tests` skill). Known failing unit test: the old
   daylight-saving one only.
2. Commit on `main` (clean tree — only committed code ships).
3. `scripts/deploy/deploy.sh` — archives HEAD, builds on the server in a limited
   systemd scope (`BUILD_OK`), backs up, runs `prisma migrate deploy`, swaps
   `/srv/ms-social-pilot{.new → ,→ .prev}`, restarts `social-pilot` and
   `social-pilot-worker`, checks /api/health and the three WordPress sites.
   Ends with `DEPLOY_OK <hash>`. A single `curl: (7)` line during restart is normal.
4. Problems: `scripts/deploy/deploy.sh --rollback`; logs with
   `ssh -i ~/.ssh/SebMouadSSH root@213.246.45.75 'journalctl -u social-pilot -n 100'`.
5. After deploy, verify the change live in the owner's Chrome with real data.
Never read production database contents; never restore a DB without the owner's OK.
