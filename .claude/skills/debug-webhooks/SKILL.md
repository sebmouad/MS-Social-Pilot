---
name: debug-webhooks
description: Troubleshoot Meta webhook delivery failures for MS Social Pilot — missing events, signature errors, verification failures.
---

# Debug webhooks

1. List subscriptions: DevTools MCP `devtools_webhook_list` (app 699780715171676)
   and `GET /{page-id}/subscribed_apps` for each Page.
2. Send a test: `devtools_webhook_test`; watch
   `journalctl -u social-pilot -f` on the server.
3. Common causes: callback URL not public/HTTPS, OpenLiteSpeed blocking POST
   bodies, wrong verify token, HMAC computed over a re-serialised body (must be the
   raw body), app secret rotated, Page not subscribed, app in Development mode for
   the event's user, slow handler (> 20 s → Meta retries then disables).
4. Fix, add a regression test with a captured payload, deploy, re-test.
