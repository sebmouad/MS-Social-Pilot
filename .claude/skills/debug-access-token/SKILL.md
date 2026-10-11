---
name: debug-access-token
description: Diagnose expired, revoked or under-scoped Facebook tokens in MS Social Pilot — "reconnect required", publishing auth failures, missing permissions.
---

# Debug access tokens

1. In the app (owner's Chrome, read-only): Connections → **Check token** and
   **Run checks** on the profile. They show expiry, granted scopes and per-Page
   problems.
2. Code paths: `src/lib/health.ts` (connection checks), `src/lib/accounts.ts`
   (`checkAccountHealth`), `SocialAccount.invalidatedAt/invalidReason`,
   `Target.publishBlocker(Code)`, token-expiry job in `src/lib/scheduler/jobs.ts`.
3. Meta side: DevTools MCP `devtools_app` (basic_settings/security) and
   `devtools_app_review privileges` for app 699780715171676 — a permission that is
   not approved or not live cannot be granted to normal users.
4. Typical causes: password change / session logout (re-login), permission
   removed in Facebook settings, app in Development mode for a non-tester,
   permission not in the requested scopes, Page role lost.
5. Fix = the owner reconnects Facebook (Connections → Reconnect). Never ask for or
   handle the owner's password or tokens.
6. Server logs for the failure: `journalctl -u social-pilot-worker -n 200`
   (see `docs/ai/RELEASE.md` for access).
