# LinkedIn platform

Module implementation and fixture evidence; **staged, not installed in the dispatch host**.
Disabled by default. No live-provider, browser, production or database evidence.

## Owned behavior

- `manifest.ts`: member/company destinations; publishing and remote status only.
- `config.ts`: six Root entries, included in `PLATFORM_CONFIG`; no schema-version bump.
- `runtime.ts`: validated Root policy/credentials and EN/FR safe failures.
- `connection.ts`, `oauth-state.ts`: requestOrigin callback, encrypted state bound to
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

## Integration still required

The lane is constrained to platform folders, platform registration, tests and the
legacy sweep. The central server registration file has not been edited pending
ownership clarification. To install atomically:

1. In `src/platforms/index.ts`, import `linkedinModule` from `./linkedin/manifest`,
   append it to `PLATFORM_MODULES`, remove `linkedin` from `STAGED_PLATFORM_IDS`.
2. In `src/server/platforms/index.ts`, import `linkedinHost` from
   `@/platforms/linkedin/host` and add `linkedin: linkedinHost` to `PLATFORM_HOSTS`.
3. Document the mappings in `docs/MCP_PARITY.md` and architecture status:

| Capability | UI | REST | MCP | Shared service |
| --- | --- | --- | --- | --- |
| Start LinkedIn connection | Settings connections | POST /api/connections/[platform]/start | start_connection | Settings startConnection; START CONNECTION linkedin; audited |
| Select/disconnect discovered channels | Settings connections | PATCH/DELETE /api/connections | set_connection_selections / disconnect_connection | Settings confirmed mutation services |
| Publish / reconcile | Publishing composer/post detail | Existing publishing routes | Existing publishing tools | Publishing lifecycle services dispatch adapter; no provider-specific endpoint/tool |

Run parity guard, config validation, platform dispatch, TypeScript and whole suite
after central registration. Shared service tests are not live REST/MCP evidence.

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
