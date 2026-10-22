---
name: deploy-production
description: Deploy MS Social Pilot to production (social.newsgeet.com) safely, or roll back. Use whenever changes are committed and tests pass, or when the owner says deploy.
---

# Deploy to production

Full detail: `rebuild/docs/OPERATIONS.md`, `rebuild/docs/CUTOVER.md`.

1. Tests green (`run-tests` skill). Known sandbox-only failures: the
   `facebook-native-http` loopback `listen EPERM ::1` tests.
2. Commit on `main` (clean tree — only committed code ships).
3. `bash rebuild/scripts/prod-deploy.sh` — ships origin/main's `rebuild/` tree,
   backs up, applies unrecorded migrations (marking the baseline applied on
   migrated databases), swaps `/srv/ms-social-pilot-rebuild{.new → ,→ .prev}`,
   restarts `social-pilot-rebuild` and `social-pilot-rebuild-worker`, checks
   /api/health and the three WordPress sites. Ends with `DEPLOY OK <hash>`.
   A single `curl: (7)` line during restart is normal.
4. Problems: restore `/srv/ms-social-pilot-rebuild.prev` (a database restore
   needs the owner's OK); logs with
   `ssh -i ~/.ssh/SebMouadSSH root@213.246.45.75 'journalctl -u social-pilot-rebuild -n 100'`.
5. After deploy, verify the change live in the owner's Chrome with real data.
Never read production database contents; never restore a DB without the owner's OK.
