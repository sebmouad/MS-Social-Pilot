---
name: meta-api-integration
description: Build or change anything that calls the Facebook/Instagram Graph API in MS Social Pilot — publishing, insights, comments, inbox, ads, OAuth scopes, permissions. Covers setup, authentication, permissions and working examples.
---

# Meta Graph API integration

1. Read `docs/ai/META_API_NOTES.md` (verified facts: reactions edge, follows
   breakdowns need period=day, retired metrics, appsecret_proof, Page can't hide its
   own comments) and `docs/META_APP_SETUP.md`.
2. Always go through `src/lib/facebook/graph.ts` (`graphRequest`, `graphPaged`):
   it adds `appsecret_proof`, version, timeouts, budget accounting and maps errors
   to `GraphError` kinds (`auth`, `permission`, `rate_limit`, `transient`,
   `rejected`) that drive retries in `src/lib/scheduler/backoff.ts`.
3. Tokens: Page tokens on `Target.accessToken`, user tokens on
   `SocialAccount.accessToken`, both encrypted (`encryptSecret`/`decryptSecret`).
   Use `tokenFor(target)` helpers; never log tokens.
4. Scopes: `env.facebookScopes`; new permissions go behind a feature switch in
   `src/lib/settings/definitions.ts` until Meta approves them (an unapproved scope
   breaks the whole login dialog). Describe them in `src/lib/facebook/permissions.ts`.
5. Metrics: add to the catalogue `src/lib/facebook/metrics.ts` with the periods
   Graph actually serves; probe live with the app's coverage tool
   (Analytics → Overview → Technical details → Test coverage).
6. Check changes against Meta with the DevTools MCP: `devtools_api_changelog`,
   `devtools_api_usage`, and docs search (see the `search-meta-docs` skill).
7. Tests: mock Graph with a local server + `FACEBOOK_GRAPH_BASE_URL` or
   `vi.stubGlobal('fetch')`. Then a live check on DIY Page 3 with the owner's OK
   (`live-facebook-test` skill).

App: MS-Social-Pilot, ID 699780715171676.
