# Feed previews and reviewer notices — round 9

The existing check service already returned bounded rendered post text through
its UI, REST and MCP paths. The customer check-result dialog now exposes that
exact text in a keyboard-operable disclosure per entry, alongside an optional
http(s) article link. React renders text without interpreting article HTML. New
copy is English/French in Root's existing `feeds.copy`; older saved catalogs fall
back for added keys. Existing `feeds.maxItemsPerCheck`, message, excerpt and entry
limits bound source/result text. No additional preview fetch or post creation is
introduced by opening a disclosure. Empty rendered messages cannot enable the
creation buttons by themselves.

`feeds.approvalNotificationsEnabled` is a new active boolean Root setting,
default true. Each newly created held post queues the existing Settings-owned
`approval_request` event in the same transaction, after its destination/version
records. The event ID is the new post ID, and the existing notification producer
owns recipient authorization, preferences, durable delivery and duplicate guards.
No events are emitted for preview, draft, automatically approved scheduled, or
already-ingested items. A queue failure refuses the transaction's success; the
feed item is not intentionally consumed independently of its post/notice. The
worker and UI/REST/MCP manual checks all use this same ingest service. Returned
`reviewerNotificationsQueued` counts local queued recipient notifications, not
SMTP delivery or human review; the bilingual UI discloses that distinction.

No routes outside ownership need changing for these two capabilities. The
integrator must bump CONFIG_SCHEMA_VERSION for the new key. Architecture status,
shared handoff and operation docs are outside this worker's owned paths; reconcile
them with this note. Tests use fake ports and jsdom. Actual PostgreSQL atomicity,
concurrent workers, browser themes/phone/keyboard matrix, notification delivery,
real MCP clients and production/provider results remain unverified.

Final local verification: `npx tsc --noEmit -p .` exited 0. Targeted Vitest
(`--cache=false`, because linked node_modules cache is outside writable scope):
94/94 tests passed across media-library-service, media-library-module,
media-rename-entrypoints, feeds-service, feeds-mcp, feeds-polling and
legacy-round9-ui. `git diff --check` passed. No full suite or build was run.
