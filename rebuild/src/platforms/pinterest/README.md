# Pinterest platform

Module implementation and fixture evidence; **staged, not installed in the dispatch host**.
Disabled by default. No live-provider, browser, production or database evidence.

## Owned behavior

- `manifest.ts`: boards, image Pins, remote status and deletion only.
- `config.ts`: six typed Root entries registered through `PLATFORM_CONFIG`.
- `runtime.ts`: validated Root policy/credentials and safe English/French failures.
- `connection.ts`, `oauth-state.ts`: requestOrigin callback and encrypted CSRF
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

## Integration still required

1. Import `pinterestModule` from `./pinterest/manifest` in `src/platforms/index.ts`,
   append to `PLATFORM_MODULES`, remove `pinterest` from `STAGED_PLATFORM_IDS`.
2. Import `pinterestHost` from `@/platforms/pinterest/host` in
   `src/server/platforms/index.ts`; register `pinterest: pinterestHost`.
3. Update architecture status and `docs/MCP_PARITY.md` with these existing surfaces:

| Capability | UI | REST | MCP | Shared service |
| --- | --- | --- | --- | --- |
| Start Pinterest connection | Settings connections | POST /api/connections/[platform]/start | start_connection | Settings startConnection; START CONNECTION pinterest; audited |
| Selection/disconnect | Settings connections | PATCH/DELETE /api/connections | set_connection_selections / disconnect_connection | Settings confirmed mutation services |
| Publish/status/delete | Publishing composer/post detail | Existing publishing lifecycle routes | Existing publishing lifecycle tools | Shared Publishing lifecycle and confirmed delete services dispatch adapter |
| Root refresh | Root connection controls | Existing Root connection refresh route | Existing private Root refresh tool | Root exact REFRESH CONNECTION service calls renewToken |

The central server file/docs are outside the specified platform lane pending
ownership clarification. Install atomically and rerun parity/config/dispatch,
TypeScript and the full suite. No provider-specific routes or duplicate tools needed.

## Remaining legacy/release gaps

- **Automatic refresh near expiry is not implemented.** The host renewal hook is
  available to Root's existing refresh service after installation, but that shared
  service updates only `social_accounts`, while Publishing reads `targets.accessToken`.
  The shared renewal owner must atomically rotate all same-source destination
  credentials under resource locks and avoid resurrecting disconnected resources.
  Add automatic policy-qualified refresh before publication eligibility checks;
  expired credentials currently fail closed. This prevents claiming legacy parity.
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
