# LinkedIn platform

Installed-module implementation and synthetic fixture evidence; central registration is owned by the integration lane.
Disabled by default. No live-provider, browser, production or database evidence.

## Owned behavior

- `module.ts` (`manifest.ts` compatibility export): member/company destinations; publishing and remote status only.
- `config.ts`: six Root entries, included in `PLATFORM_CONFIG`; no schema-version bump.
- `runtime.ts`: validated Root policy/credentials and EN/FR safe failures.
- `connection.ts`, `oauth-state.ts`: Root `app.publicOrigin` callback, encrypted state bound to
  actor/workspace/redirect/expiry, current owner/admin and entitlement checks,
  encrypted tokens, selection-preserving reconnection, resource locks and audit.
  New destinations are always unselected; collisions never take another connection.
- `adapter.ts`, `transport.ts`: member discovery and optional paginated administrator
  company discovery; text, article, single/multiple local-byte image publishing;
  versioned REST headers, escaped commentary, scoped/host-checked uploads, receipt
  validation and post+author status verification. Reads fail on exhausted pagination.

Root keys: `platforms.linkedin.enabled`, `platforms.linkedin.includedByDefault`,
`platforms.linkedin.planFeatures`, `linkedin.clientId`, `linkedin.clientSecret`,
`linkedin.policy`. Policy owns endpoint roots, API version, scopes, timeout,
page bounds, OAuth expiry/code bound, image/text/upload limits, upload allowlist,
company access toggle, format labels and safe English/French copy.

Protocol identities (not deployment settings): adapter id, callback route/cookie,
REST resource paths, JSON field names/enums, OAuth grant types, Rest.li 2.0.0,
URN syntax, 256-bit CSRF state, authenticated v1 encryption and HTTP status meaning.
Provider endpoint origins and operational bounds are Root values.

## Shared host integration

The integration lane registers `linkedinModule` from `./linkedin/module` and
`linkedinHost` from `@/platforms/linkedin/host`. Settings supplies connection
start, callback, discovery selection and confirmed retain/delete disconnect.
Publishing supplies shared publish/status lifecycle services; Pinterest also
implements remote deletion. No duplicate provider REST routes or MCP tools exist.

OAuth callback and completion redirects read Root `app.publicOrigin` directly;
request forwarding headers do not choose the callback origin. The host exposes
refresh-token renewal with expiry and preserves an unrotated refresh token.
LinkedIn refresh tokens require provider program eligibility; missing refresh
credentials return null and expired credentials must require reconnection.

Legacy `app_settings` mapping (owner enters these in Root; no secret import or
production mutation was performed): `linkedin.clientId` → `linkedin.clientId`,
`linkedin.clientSecret` → `linkedin.clientSecret`. Requested grants live in
`linkedin.policy.scopes`; LinkedIn company grants additionally use
`linkedin.policy.organizationScopes` and `organizationsEnabled`.

Synthetic validation: `tests/oauth-two-install.test.ts` and
`tests/networks-linkedin-pinterest.test.ts`: 43 assertions pass, covering Root
origin, access refusals, refresh hooks and adapter/discovery/publishing behavior.
No browser, live provider, database, production or real REST/MCP evidence.

## Deliberate limitations and release gaps

- Company discovery requires explicit Root opt-in and all returned company grants.
  Member status requires `r_member_social`; ordinary self-serve sharing grants
  cannot read status and correctly produce unknown. No first comment, remote
  delete, native scheduling, video, inbox, analytics or Ads is advertised.
- Only returned token scopes are persisted. An omitted scope response does not
  inherit requested authority. Validate actual provider scope receipts before release.
- Publishing's media contract has no article preview title/description, so legacy
  custom article preview metadata cannot be passed through this adapter.
- Shared manifest names/brand metadata are static in the current host contract;
  extending Root control of that metadata requires the owning shared interface.
- PostgreSQL races/locks, actual grants/app approval, local image delivery and
  provider image processing need separate integration/live verification.

Provider references: [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
[Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api).

Automatic renewal uses Root policy `renewLeadSeconds` (default one day) and the
neutral `renewProviderTokens` service; no separate provider scheduler is created.
