# Facebook adapter

`createFacebookAdapter` implements the rebuild's provider-neutral contract. `createFacebookEngine` exposes the richer Page and Marketing API operations for service layers that need Page tokens, conversations, and raw insight rows. All Graph and OAuth endpoint hosts, API version, credentials, permission scopes, and insight fields are injected by this module’s `runtime.ts` from Root settings; this module has no production endpoint/version or field catalogue defaults.

Supported operations:

- OAuth authorization URL and authorization-code exchange (short-lived token response); the server flow is assembled in `host.ts`, with callback/state handling in `connection.ts` and encrypted discovery persistence in `discovery.ts`.
- Discover Pages and ad accounts, including Page access tokens for secure host-side persistence.
- Publish text/link, a remotely hosted image or video, multiple images, or server-supplied local image bytes through Meta's Page Photos upload; publish a first comment through a separate operation after the application commits the post receipt.
- Read publish state, delete a remote post, list Page conversations and post comments, reply to a conversation or comment, and hide/unhide a comment.
- Read configured Page insights and daily account-level Ads Insights; read live configured/effective status for insight-verified campaign/ad-set/ad objects; update campaign/ad-set/ad status and daily or lifetime budget.

The adapter declares connection supported; its server-host flow implements OAuth callback/state validation, encrypted discovery storage, long-lived token exchange and workspace authorization. This is implementation evidence; live authorization, renewal and revocation coverage remain release gates. Page tokens returned by `discoverPages` are secrets and must never be returned to browsers or logs. Request only the Meta permissions required for enabled features; inbox scope sets are supplied through `meta.inboxReadScopes` and `meta.inboxWriteScopes`, and the host checks each selected Page's recorded grants before reading or mutating. Ad updates require `ads_management`, while ad insights use Marketing API access. Ads Insights requires the caller to pass an explicit date range. Graph may reject metrics, endpoints, or operations based on app review, API version, token type, Page eligibility, or granted permissions.

Image bytes are sent as multipart `source` data to the Page Photos edge. Root controls the per-image byte ceiling (`meta.maxImageUploadBytes`) and accepted MIME types (`meta.allowedImageMimeTypes`); the adapter checks both and verifies JPEG, PNG, or GIF signatures before sending. The composer uploads workspace-scoped image bytes through `/api/media`, persists only an opaque media reference in the draft, and the publishing lifecycle resolves bytes server-side and checks adapter-specific limits before any provider call. Multi-photo posts upload images unpublished with `temporary=true`, then attach the returned photo IDs to a feed post. Local browser testing covers draft upload, preview, first comment persistence, and deletion; a real Page photo publish remains unverified. This slice does not implement local video uploads, resumable video/reel/story publishing, native scheduling, or group publishing. Inbox sync captures conversations and comments attached to locally stored published Page posts; it does not discover every Page comment, reaction, or review. The host stores replies, local resolution state, and comment visibility after provider confirmation and records audit events. Ads management can create paused campaigns, read live status for insight-verified objects, and update object status or budget; paused ad-set creation exists through `adset.ts`; ad creation, creative and targeting edits, and deletion are not implemented. App-level retries, rate-limit scheduling, token refresh, webhook ingestion, and remote/live integration checks remain host responsibilities.

`host.ts` owns this provider’s server assembly and combined analytics job. `oauth-state.ts` owns its encrypted callback challenge and cookie identity. Provider objective types and transient Graph error codes live in `protocol.ts`; `FacebookApiError` exposes a neutral retry hint consumed by shared jobs. These boundaries do not establish live-provider or complete capability coverage.

Private adapter diagnostics live in `diagnostics.ts`, attached through `host.ts`. Root can validate configuration presence and test one selected connection’s identity, current requested grants, and Page/ad-account discovery without changing provider records or app selections. Errors are mapped to safe codes/copy; tokens and discovered names are excluded from diagnostic receipts. Discovery obeys this adapter’s pagination settings, so counts describe returned resources rather than an asserted complete portfolio. `configuredFacebookEngine({signal})` combines the suite cancellation signal with each normal request timeout. Passing these probes does not prove per-resource publishing, inbox, analytics, ads writes or callback registration; those need operation-level live evidence.

First comments use their own Root `meta.firstCommentScopes` policy, included in OAuth and checked against recorded grants before dispatch. Publishing and remote deletion similarly require nonempty Root policies `meta.postPublishScopes` and `meta.postDeleteScopes` (default `pages_manage_posts`) and recorded matching grants before the adapter sends a provider request. OAuth combines those policies with `meta.postReadScopes`, inbox scopes, and first-comment scopes without duplicates. This is a local readiness preflight; it does not check whether a grant has since expired or been revoked at Meta. Single-photo publication stores the returned `post_id` when present and rejects a malformed explicit value; the photo `id` is only a fallback when `post_id` is absent. Post-create and comment failures use the adapter-owned conservative classification in `protocol.ts`; ambiguous responses do not authorize retry. The product service owns receipt persistence, attempt claims and human reconciliation (see `docs/FIRST_COMMENT_DELIVERY.md`). The engine never combines post creation with comment dispatch, preventing comment failure from hiding a successful post receipt. This remains local fixture/test evidence rather than live Facebook proof.

Meta scope defaults are operator policies, not evidence that the app has been reviewed or that the current API accepts a request. Verify current Meta permissions and API-version behavior in the official documentation and app dashboard before enabling a live connection. Official references: [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/) and [Pages API](https://developers.facebook.com/docs/pages-api/).

`PublishRequest.operationId` is optional opaque attempt-correlation metadata. Facebook does not map it to a Graph idempotency key, and its presence makes no promise that repeating a create is safe. `classifyPublishingFailure` returns `rejected` only for the explicit recognized Graph error-code set on non-transient HTTP 4xx responses other than 429. Generic or unknown errors, transport loss, cancellation, malformed success responses, throttling and server failures remain `uncertain`; the shared recovery service must preserve the attempt for reconciliation rather than infer that no post was created. This classification follows the same conservative provider rule used for first comments, applied to post creation errors too. Local tests cover the boundary; live Graph behavior and current Meta documentation have not been verified in this batch.

Workspace access is declared by this module and configured in Root through
`platforms.facebook.includedByDefault` and `platforms.facebook.planFeatures`.
Facebook remains included by default; Root may require an existing subscriber
plan key instead. Shared policy resolution also requires installation enablement
and denies invalid policies and suspended customer workspaces. These policies
control current customer access, not provider approval or data retention.
Complete subscription administration and provider-owned background collector
plan gating remain separate unfinished work.

Authenticated Graph requests now use the module-owned HMAC-SHA256
`appsecret_proof`, controlled by Root `meta.appSecretProofEnabled` (default true)
and the encrypted app secret. Engine queries, form/multipart writes, pagination
and ad-set ownership/create requests are covered. Pagination replaces incoming
tokens/proofs with the actual caller credential; OAuth protocols remain separate.
Missing/unreadable signing material cannot dispatch and does not hide stored
history. Ads live readiness also checks required signing material. The real
engine's six read checks passed on Graph v26.0; no live writes were tested.
See `docs/FACEBOOK_REQUEST_SIGNING.md` for exact evidence and open limitations;
older local-only evidence statements above remain applicable to their operations.


Multi-photo staging now uses the pure `media-journal-port.ts` and module-owned
`media-journal.ts` store, injected by configured runtime construction. Its
`media-recovery-host.ts` is registered through the narrow installed safety registry
without constructing an API engine. Per-photo/feed intents and receipts commit
before sequencing continues. Partial effects remain held; cleanup/reconciliation
is unfinished. See `rebuild/docs/FACEBOOK_MEDIA_RECOVERY.md` and current QA evidence.


Manual known-photo cleanup is module-owned in `media-cleanup.ts` and
`media-cleanup-transport.ts`; the pure transport port contains no persistence.
Root's generic action host renders module-defined risk/confirmation metadata.
The capability defaults off and requires external verification plus race
acknowledgment because Graph does not prove continued unused state. Separate
immutable deletion intent/receipt storage holds unknown effects; a confirmed
receipt can replay without another request. See `docs/FACEBOOK_MEDIA_RECOVERY.md`
for the exact eligibility, authorization, scope, recovery and evidence limits.

Native-format transport, Root policy and diagnostic status: [FACEBOOK_NATIVE_TRANSPORT.md](../../../docs/FACEBOOK_NATIVE_TRANSPORT.md). These dependencies do not enable native customer formats or replace the guarded parent publication journal.
