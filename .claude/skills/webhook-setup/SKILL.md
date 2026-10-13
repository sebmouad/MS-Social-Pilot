---
name: webhook-setup
description: Configure and test Meta webhooks (Page feed, messages, comments) for MS Social Pilot when real-time updates are wanted instead of polling.
---

# Webhook setup

Today the app polls (worker `edges` job every few hours, Pull buttons on demand)
and only handles the deauthorize/data-deletion callbacks. To add webhooks:
1. Route: `src/app/api/facebook/webhook/route.ts` — GET verification
   (`hub.mode`, `hub.verify_token` from a new secret setting, echo `hub.challenge`),
   POST with `X-Hub-Signature-256` HMAC check using the app secret (reject if bad).
   Add it to `PUBLIC` in `tests/api-routes.integration.test.ts`.
2. Subscribe the app (DevTools MCP `devtools_webhook_manage`) to `page` fields
   (`feed`, `messages` after Meta step 2) and each Page via
   `POST /{page-id}/subscribed_apps` (needs pages_manage_metadata).
3. Handle events idempotently: upsert comments/conversations by id; enqueue work,
   answer 200 fast.
4. Test: `devtools_webhook_test`, then a live comment on DIY Page 3 with the owner's OK.
5. Document in `docs/META_API_NOTES.md`.
