# Pinterest platform

Installed-module implementation and synthetic fixture evidence; central registration is owned by the integration lane.
Disabled by default. No live-provider, browser, production or database evidence.

## Owned behavior

- `module.ts` (`manifest.ts` compatibility export): boards, image Pins, remote status and deletion only.
- `config.ts`: six typed Root entries registered through `PLATFORM_CONFIG`.
- `runtime.ts`: validated Root policy/credentials and safe English/French failures.
- `connection.ts`, `oauth-state.ts`: Root `app.publicOrigin` callback and encrypted CSRF
  state bound to actor/workspace/redirect/expiry, owner/admin/current access
  checks, encrypted token persistence, locked/audited reconnection. New boards
  are unselected. Other connections' colliding resources are never reassigned.
- `adapter.ts`, `transport.ts`: token exchange, Basic-auth refresh, user discovery,
  bookmark-paginated boards (repeated/exhausted bookmarks fail closed), single/
  multiple-image URL Pins, bounded title/description/alt text, actual Pin receipt,
  board+Pin identity status verification and idempotent remote deletion.
- `host.ts`: module-owned assembly and server-only renewal hook.

Root keys: `platforms.pinterest.enabled`, `platforms.pinterest.includedByDefault`,
`platforms.pinterest.planFeatures`, `pinterest.clientId`, `pinterest.clientSecret`,
`pinterest.policy`. Policy owns endpoint roots, scopes, timeout, page bounds,
OAuth expiry/code bound, image/text/title/alt limits, format and safe EN/FR copy.
`CONFIG_SCHEMA_VERSION` is unchanged; integrator must bump it for new keys.

Protocol invariants: module/route/cookie identities, v5 resource paths and wire
field names/enums, grant types, Basic encoding, 256-bit CSRF nonce, authenticated
v1 encryption and HTTP semantics. Operational settings are Root values.

## Shared host integration

The integration lane registers `pinterestModule` from `./pinterest/module` and
`pinterestHost` from `@/platforms/pinterest/host`. Settings supplies connection
start, callback, discovery selection and confirmed retain/delete disconnect.
Publishing supplies shared publish/status lifecycle services; Pinterest also
implements remote deletion. No duplicate provider REST routes or MCP tools exist.

OAuth callback and completion redirects read Root `app.publicOrigin` directly;
request forwarding headers do not choose the callback origin. The host exposes
refresh-token renewal with expiry and preserves an unrotated refresh token.
LinkedIn refresh tokens require provider program eligibility; missing refresh
credentials return null and expired credentials must require reconnection.

Legacy `app_settings` mapping (owner enters these in Root; no secret import or
production mutation was performed): `pinterest.clientId` → `pinterest.clientId`,
`pinterest.clientSecret` → `pinterest.clientSecret`. Requested grants live in
`pinterest.policy.scopes`; LinkedIn company grants additionally use
`linkedin.policy.organizationScopes` and `organizationsEnabled`.

Synthetic validation: `tests/oauth-two-install.test.ts` and
`tests/networks-linkedin-pinterest.test.ts`: 43 assertions pass, covering Root
origin, access refusals, refresh hooks and adapter/discovery/publishing behavior.
No browser, live provider, database, production or real REST/MCP evidence.

## Remaining legacy/release gaps

- Automatic renewal is wired through the provider-owned posts job with typed
  `policy.renewLeadSeconds`, delegating enabled-selection, current workspace access,
  locking and atomic credential rotation to `renewProviderTokens`. Worker/database
  behavior and live token rotation still require integration verification.
- Returned scope receipts only; omitted scope response does not imply permission.
- No custom preview title in neutral PublishRequest; first nonempty caption line
  is the Pin title. No native scheduling, first comments, video, inbox, analytics
  or Ads. No new tables/migrations required.
- The shared media descriptor has no minimum-image count. The adapter refuses
  text-only Pins; composer prevalidation needs an optional neutral minImages field.
- Actual Pinterest approval, public image fetching, status/deletion, refresh-token
  rotation, locks/races and real UI/REST/MCP calls need integration/live evidence.
- Current static manifest brand metadata needs shared host support for Root overrides.

References: [Pin/board creation](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/),
[OAuth and renewal](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/).

Automatic renewal uses Root policy `renewLeadSeconds` (default one day) and the
neutral `renewProviderTokens` service; no separate provider scheduler is created.
