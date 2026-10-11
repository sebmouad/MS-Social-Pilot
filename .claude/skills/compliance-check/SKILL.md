---
name: compliance-check
description: Review Meta Platform policy compliance for MS Social Pilot — violations, required actions, data use, deletion callbacks, privacy policy accuracy.
---

# Compliance check

1. DevTools MCP `devtools_compliance` for app 699780715171676 — list open
   violations and required actions with deadlines; report them first.
2. Verify the public pages are reachable and accurate: `/privacy-policy`, `/terms`,
   `/data-deletion` (English only, `src/components/LegalPage.tsx`). The privacy
   policy must describe every permission actually requested.
3. Data deletion: `src/app/api/facebook/data-deletion/route.ts` and deauthorize
   handling remove the user's tokens and data; test with a signed request.
4. Data minimisation: tokens encrypted at rest, retention jobs in
   `src/lib/housekeeping.ts`, settings under Configuration → Data retention.
5. Never request scopes the app doesn't use; feature switches keep unapproved ones off.
6. Report findings to the owner; changes to the Meta app need their OK.
