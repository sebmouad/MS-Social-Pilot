# Facebook authenticated request signing

2026-10-17. This batch closes a live Graph transport defect; it does not complete
the Facebook module or authorize production cutover by itself.

## Ownership and configuration

Facebook owns the lowercase hexadecimal HMAC-SHA256 of the actual access token,
keyed by its server-only app secret, and the `appsecret_proof` protocol field.
`protocol.ts` contains the helper. The engine signs Graph GET/DELETE queries,
form POST bodies, multipart photo bodies and every paginated request. The
separate ad-set transport signs campaign ownership reads and paused creation.
OAuth browser URLs contain neither secret nor proof; token exchanges keep their
separate client-secret protocol.

Registry **48** adds `meta.appSecretProofEnabled`, default true, under Root →
Platform modules → Facebook → API credentials. Existing encrypted
`meta.appSecret` supplies signing material. Both configured engine/adapter and
ad-set construction consume the policy. Root reuses validated, audited
configuration UI/API/private MCP services. No customer setup instructions or
shared provider-specific rules were added.

Missing signing material fails before fetch. Publishing, first-comment, status
and remote-deletion readiness fails before dispatch. Missing/unreadable secrets
do not prevent constructing safe adapter metadata or selected stored history;
Root diagnostics retains its separate configuration-validation checks. Facebook
Ads exposes neutral host readiness, consulted by shared live read/manage services
and direct mutations. Stored Ads history keeps its existing read boundary.
Explicitly disabling proof permits unsigned requests but cannot override a
provider app that requires signing.

Pagination checks origin/API-version path and rejects userinfo/fragments before
credential injection. Incoming token/proof fields are replaced with the caller
token and its fresh proof; disabled signing removes stale proofs. Existing
redirect refusal, page bounds and cancellation remain in force.

## Live evidence and limits

The unsigned rebuild engine failed identity, permission and discovery reads with
Graph HTTP 400/code 100. Sanitized classification identified required proof.
The signed engine then passed **6/6** read checks on the authorized host, using
credentials decrypted only in host memory and existing Graph **v26.0** settings:

- User identity and one selected Page identity matched stored identities.
- Current permissions returned 14 grants, including `ads_read`; the connection
  did **not** have `ads_management`.
- Page discovery returned 10 Pages and included the sampled selected Page.
- Ad-account discovery returned 5 accounts.
- Four configured Page metrics returned 24 observations with no failed metrics:
  `page_follows`, `page_media_view`, `page_post_engagements`, `page_views_total`.

Engine bundle SHA-256:
`bd111275b348793e370f27411708f0ab3753499dcea81ab8111b99a25b119898`.
The bundle came from this batch's reviewed working tree based on `213ee30`.
Counts describe the bounded returned sample, not complete portfolio coverage.
Values, customer names/IDs, tokens, proofs and secrets were omitted from output.

This was an **engine-only legacy credential bridge**, not a deployed rebuild,
OAuth callback test, Root configuration migration or live UI/API/MCP test.
No provider/database writes, settings/schema changes or service restarts occurred.
Private remote probe files were removed. Legacy web, worker and proxy remained
active; loopback/public health both returned HTTP 200.

Live publishing, photo/video, first comments, remote status/deletion, Inbox and
Ads reporting/management still need operation-level verification and cleanup.
Ads writes also require a genuinely granted management permission. Native
scheduling, local video/Reels/Stories, complete Ads lifecycle, all available
metrics, renewal/webhooks, full legacy parity and release gates remain open.

## Reproducing the bounded read probe

`scripts/verify-facebook-live-read.mjs` is an operator verification tool, not
application runtime. Review before running on an authorized legacy host.
Bundle `src/platforms/facebook/publishing.ts` with esbuild for Node ESM into
`socialpilot-facebook-engine49.mjs`. Export the public registry defaults into
`socialpilot-facebook-defaults49.json`: use the `FacebookConfig` fields except
the secret, with `requestTimeoutMs` from `meta.requestTimeoutMs`, plus
`probeRequiredScopes` containing the union of `meta.postReadScopes` and
`meta.adsReadScopes`. Signing policy must be true. Transfer only these nonsecret
files and the probe into a private mode-0700 temporary directory.

Explicit inputs: `MSP_FACEBOOK_PROBE_APP_ROOT`, `MSP_FACEBOOK_PROBE_DIR`,
`MSP_FACEBOOK_PROBE_SHA256` and `MSP_FACEBOOK_PROBE_GRAPH_ORIGIN`. Supply the
reviewed application directory, temporary directory, bundle digest and HTTPS
Graph origin; paths are not product defaults. Run Node on that host with its
legacy environment and `--import tsx`, without displaying its environment file.
The probe checks digest/origin, loads local configuration, queries one eligible
connection in a read-only transaction and performs six engine reads. Output
is allowlisted. Failed identity/grants or incomplete/empty metric observations
produce a nonzero exit; they cannot be counted as complete coverage. The fixed
two-day window is probe policy, not an application sync default. Remove the exact
temporary files/directory afterward and verify health.

Local synthetic browser and automated transport evidence lives in
[PREVIEW_QA.md](PREVIEW_QA.md). Official Meta documentation requests during this
batch returned HTTP 429; no fresh documentation-verification claim is made.
