---
name: search-meta-docs
description: Search Meta developer documentation (Graph API, Pages API, Instagram, Marketing API, Threads, App Review, webhooks) and turn findings into code or notes for MS Social Pilot.
---

# Search Meta developer docs

1. DevTools MCP first: `devtools_discovery` / `devtools_api_changelog` for
   authoritative, current answers.
2. Then the web: `WebSearch` with site hints (developers.facebook.com), and
   `WebFetch` on the page (`.md` variants exist for some docs, e.g.
   https://developers.facebook.com/documentation/pages-api/platforminsights/page.md).
3. Trust live behaviour over docs: confirm a metric or field with the app's
   coverage probe or a read-only call through the app before relying on it.
4. Record anything surprising in `docs/META_API_NOTES.md` with the date.
