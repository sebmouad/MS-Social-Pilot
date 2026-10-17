# Facebook request signing

2026-10-17. Live read-only verification of the exact rebuild engine against the
authorized production connection returned Graph HTTP 400/code 100 across
identity, permissions and discovery. Sanitized classification confirmed that
Meta requires appsecret_proof. No credentials left the host; no provider or
production database writes occurred. The legacy client already signs requests.

## Required behavior

Facebook owns HMAC-SHA256 access-token signing and the appsecret_proof wire
field. Normal Graph GET, DELETE, form POST, multipart upload and every paginated
read must use a proof generated from the actual credential and Root-managed
app secret. Pagination cannot replace the caller token or proof with values
from a next URL. OAuth browser authorization must never contain app secrets or
proofs; OAuth exchange flows keep their own established protocol.

Registry 48 adds a consumed Facebook-owned `meta.appSecretProofEnabled`
boolean, default true. Existing encrypted `meta.appSecret` supplies signing
material. Runtime construction reads both without exposing either in client
metadata or logging secrets. Bare adapter tests can explicitly disable signing
when no authenticated provider operation is under test; production runtime
always supplies the configured policy.

Missing signing material must fail before transport. It must also make write
credential readiness false before publication intent can be claimed. It must
not hide retained stored post history or prevent constructing safe adapter
capability metadata. Do not require the secret just to enumerate installed
metadata. Customers receive safe existing unavailable/reconnect behavior;
private Root owns technical configuration and diagnostics.

## Implementation and proof

1. Lower-cost provider agent: signing configuration/type/protocol helper,
   engine request/pagination integration and focused failing-then-passing tests.
2. Lower-cost runtime/config agent: registry 48, Root policy ownership, secret
   injection, configuration tests and direct metadata/readiness evidence.
3. Parent: integrate credential gating, review every transport/OAuth boundary,
   full tests/typecheck/build, rerun exact-bundle read-only checks on the host,
   redact results, remove private probe files, document and publish main.

Review covers alternate-token pagination, stale proof replacement, form vs
multipart placement, disabled policy, missing secret before fetch, no secret in
authorization URLs/errors, adapter metadata availability and operation readiness.
Live reads do not prove publishing/status/deletion, all Page resources, Inbox,
Ads management or complete adapter coverage. No production configuration,
service, schema or credential change is part of this bounded probe. Any
later canary writes remain a separate bounded test under the user's consent.
