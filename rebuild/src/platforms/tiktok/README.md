# TikTok platform module — installed, disabled by default

Binding target: `../../../docs/ARCHITECTURE_CONTRACT.md` §3. Evidence level:
fixture tests with a stubbed `fetch` (`tests/tiktok-platform.test.ts`,
`tests/token-connection.test.ts`, `tests/provider-http.test.ts`). No live TikTok
call, browser run or production run has been made.

Legacy reference: `src/lib/networks/tiktok.ts` and the TikTok branches of
`src/lib/networks/connect.ts`.

## What is implemented (and declared)

| Capability | State | Notes |
| --- | --- | --- |
| connection | supported | Login Kit authorization code grant with PKCE (S256). State and verifier are sealed in a cookie bound to user and workspace. Redirect URI is the Root public origin plus `/api/connections/tiktok/callback`. |
| discovery | supported | `user/info` returns the single account; it becomes one destination, **switched off** until selected. |
| publishing | supported | One video per post (Content Posting API direct post, `FILE_UPLOAD`, single chunk). Caption up to 2200 characters. Links are refused (`linkWithMedia: false`). The creator's allowed privacy levels are read first and the most open level in `tiktok.policy.privacyPreference` is used. |
| remoteStatus | supported | `post/publish/status/fetch` by publish id: `PUBLISH_COMPLETE` confirms; processing/failed stay unconfirmed. |
| remoteDelete | **unsupported** | The Content Posting API has no delete. |
| inbox, analytics, ads, first comment, native scheduling | unsupported | Not implemented. |

### Publish result semantics

After the bytes are accepted the adapter checks the publish status up to
`statusPollAttempts` times (`statusPollIntervalMs` apart). `PUBLISH_COMPLETE`
returns `published`; `FAILED` is a definite rejection; anything else, including a
failed status check, returns `submitted` with the publish id as the remote id
because the upload is already with TikTok. Shared publishing then reconciles
through `getRemoteStatus` (user-triggered “refresh status”). **There is no
background worker that resolves TikTok submissions yet**; Facebook has one
(`submitted-jobs.ts`), this module does not.

## Tokens

Access tokens last about a day; refresh tokens about a year and are **rotated**
on each refresh. `tokenExpiresAt` records the refresh token's end, the access
token's end lives in `meta.accessTokenExpiresAt` (see the YouTube README for the
three renewal paths, which are shared in `src/server/platforms/token-connection.ts`
and `token-renewal-job.ts`). A refresh rejected with HTTP 400/401, or an error
body naming an invalid grant, marks the connection revoked.

TikTok commonly answers `200` with an `error` envelope; `api.ts` checks it on
every call. `access_token_invalid` and scope errors map to a permission failure.

## Failure classification

`rejected` before the bytes are sent (media download, creator query, init,
scopes, validation); `uncertain` when the upload answer is lost. An uncertain
upload is held, never resent. Customer copy is `tiktok.policy.copy` (English and
French) and never includes provider text.

## Root settings (module-owned, `config.ts`)

`platforms.tiktok.enabled` (off), `platforms.tiktok.includedByDefault`,
`platforms.tiktok.planFeatures` (`platform_tiktok`), `tiktok.policy` (endpoints,
scopes, timeouts, size ceiling, caption limit, privacy preference, status check
bounds, state lifetime, renewal lead, bilingual copy), `tiktok.clientKey`,
`tiktok.clientSecret` (secret).

## Known limits

- Until TikTok audits the app, every post is private (`SELF_ONLY`) whatever the
  preference; this is TikTok's program rule, not a switch.
- Direct post requires the creator to have enabled it for the app and to satisfy
  TikTok's UX requirements for the audit; those are review items, not code.
- The PKCE challenge is base64url SHA-256 as in the legacy connector; if TikTok's
  live consent screen rejects it, change it in `src/server/platforms/token-connection.ts`
  (`pkceChallenge`) for this module only after a live check.
- Single-chunk upload only (default ceiling 64 MiB, a Root setting).
