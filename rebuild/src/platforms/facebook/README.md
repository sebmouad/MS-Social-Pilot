# Facebook adapter

`createFacebookAdapter` implements the rebuild's provider-neutral contract. `createFacebookEngine` exposes the richer Page and Marketing API operations for service layers that need Page tokens, conversations, and raw insight rows. All Graph and OAuth endpoint hosts, API version, credentials, permission scopes, and insight fields are injected by the host; this module has no production endpoint/version or field catalogue defaults.

Supported operations:

- OAuth authorization URL and authorization-code exchange (short-lived token response); these primitives do not constitute a complete connection flow.
- Discover Pages and ad accounts, including Page access tokens for secure host-side persistence.
- Publish text/link, a remotely hosted image or video, or multiple remotely hosted images; optionally publish a first comment.
- Read publish state, delete a remote post, list Page conversations and post comments, reply to a conversation or comment, and hide/unhide a comment.
- Read configured Page insights and daily account-level Ads Insights; update campaign/ad-set/ad status and daily or lifetime budget.

The adapter declares connection unsupported until the host completes OAuth callback/state validation, encrypted token storage, token refresh/long-lived exchange, permission review, and workspace authorization. Page tokens returned by `discoverPages` are secrets and must never be returned to browsers or logs. Request only the Meta permissions required for enabled features; inbox scope sets are supplied through `meta.inboxReadScopes` and `meta.inboxWriteScopes`, and the host checks each selected Page's recorded grants before reading or mutating. Ad updates require `ads_management`, while ad insights use Marketing API access. Ads Insights requires the caller to pass an explicit date range. Graph may reject metrics, endpoints, or operations based on app review, API version, token type, Page eligibility, or granted permissions.

Media accepts HTTPS URLs that Facebook can fetch. This slice does not stream local binary uploads, implement resumable video/reel/story publishing, native scheduling, or group publishing. Inbox sync captures conversations and comments attached to locally stored published Page posts; it does not discover every Page comment, reaction, or review. The host stores replies, local resolution state, and comment visibility after provider confirmation and records audit events. Ads mutation is limited to status and budget updates; campaign/ad creative creation, targeting changes, and deletion are not implemented. App-level retries, rate-limit scheduling, token refresh, webhook ingestion, and remote/live integration checks remain host responsibilities.
