# YouTube platform module — installed, disabled by default

Binding target: `../../../docs/ARCHITECTURE_CONTRACT.md` §3. Evidence level:
fixture tests with a stubbed `fetch` (`tests/youtube-platform.test.ts`,
`tests/token-connection.test.ts`, `tests/provider-http.test.ts`). No live Google
call, browser run or production run has been made. A connection or a passing
fixture does not prove every operation against the real API.

Legacy reference: `src/lib/networks/youtube.ts` and the YouTube branches of
`src/lib/networks/connect.ts`.

## What is implemented (and declared)

| Capability | State | Notes |
| --- | --- | --- |
| connection | supported | Google OAuth 2 code grant, `access_type=offline`, `prompt=consent`. State sealed in a cookie bound to user and workspace. Redirect URI is the Root public origin plus `/api/connections/youtube/callback`. |
| discovery | supported | `channels?mine=true` listed at connection time (paged, bounded by `channelMaxPages`). Every managed channel becomes a destination, **switched off** until the customer selects it. |
| publishing | supported | One video per post. The first non-empty line is the title (no `<`/`>`, 100 characters), text plus link is the description (5000). Resumable upload; the media is downloaded server-side from its `https` URL (public address only, size ceiling from Root). |
| remoteStatus | supported | `videos.list` confirms the video exists, belongs to the destination channel and its upload is `uploaded`/`processed`. |
| remoteDelete | supported | `videos.delete`; an already-missing video counts as removed. Needs the `youtube.force-ssl` grant. |
| inbox, analytics, ads | **unsupported** | Not implemented. Legacy read public counters (`stats`: views, likes, comments) for the old analytics screen. The rebuild has no stored-data host for YouTube yet, so analytics stays undeclared. |
| first comment, native scheduling, Shorts/thumbnail/playlist options | unsupported | Not offered. Application scheduling works through the shared queue. |

## Tokens

Google access tokens last one hour. The access token's end is kept in the
connection's `meta.accessTokenExpiresAt` (existing production column, written
through raw SQL because the rebuild Prisma mirror does not model it);
`tokenExpiresAt` stays null because Google refresh tokens do not expire. Three
paths keep credentials usable:

1. **Just before publishing** — `runtime.ts` passes `freshToken` to the adapter;
   it renews inside `youtube.policy.renewLeadSeconds` using the shared
   compare-and-set store in `src/server/platforms/token-connection.ts`.
2. **Background `posts` job** — `jobs.ts` renews every connection with an enabled
   channel ahead of expiry (workspace access rechecked each time), so status and
   delete calls, which carry no workspace identity, find a fresh stored token.
3. **Root “refresh connection”** — `connection.renewToken`.

A refresh rejected with HTTP 400/401 marks the connection revoked
(`invalidReason = refresh_rejected`) so the customer is asked to reconnect.
Destinations and history are kept.

## Failure classification

`classifyPublishingFailure` returns `rejected` for refusals before anything
exists remotely (media download, upload-session start, scopes, validation) and
`uncertain` once the bytes are being sent. A lost answer after that is never
resent automatically; the shared publishing journal holds it for review.
Customer messages come from `youtube.policy.copy` (English and French) and never
include provider text.

## Root settings (module-owned, `config.ts`)

`platforms.youtube.enabled` (off), `platforms.youtube.includedByDefault`,
`platforms.youtube.planFeatures` (`platform_youtube`), `youtube.policy`
(endpoints, connect/publish/delete scopes, timeouts, upload size, title and
description limits, visibility, made-for-kids flag, state lifetime, renewal lead,
bilingual copy), `youtube.clientId`, `youtube.clientSecret` (secret).

## Known limits

- Google keeps apps in “testing” until verified: refresh tokens then expire after
  7 days and uploads from unverified API projects are locked private. That is a
  Google program rule Root cannot bypass.
- `videos.insert` costs 1600 quota units; a daily quota bound is not modelled.
- Resumable uploads are sent in one request and are not resumed after a failure.
- Disconnecting removes local credentials only; Google access is not revoked
  remotely and the UI must not claim otherwise.
