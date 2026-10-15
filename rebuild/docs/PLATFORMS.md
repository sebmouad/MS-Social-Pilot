# Platform modules

Every social platform is a **module** that Root can switch on or off. A module
that is off is invisible to customers — no connect button, channels, ad
accounts, inbox items, analytics or MCP results — while its stored data stays
untouched; switching it back on restores everything.

## Anatomy of a module

| Part | Where | Holds |
| --- | --- | --- |
| Engine | `src/platforms/<id>/` | Provider operations behind the neutral contract in `src/platforms/types.ts` |
| Manifest + settings | `src/platforms/<id>/module.ts` | Name, badge, capabilities, channel kinds, required settings, and all of the module's Root settings (including `platforms.<id>.enabled`) |
| Server wiring | `src/server/platforms/<id>.ts` (+ `<id>-connect.ts`) | Building the engine from Root settings; the connection start/callback flow |
| Background work | `src/platforms/<id>/jobs.ts` | Provider-specific status, analytics, ads, and inbox sync hooks dispatched by the shared worker |
| Installed list | `src/platforms/index.ts` and `src/server/platforms/index.ts` | The only places that name platforms; TypeScript keeps the two in step |

Generated from the installed list: the Root configuration groups
(`<Name> · …`), the Root → Platforms screen with each module's switch and setup
state, the customer Connections buttons (only modules that are on **and** set
up), the generic routes `/api/connections/<id>/start|callback`, and the
`enabledSocialAccountWhere()` filter applied to every customer-facing list.
Product code reaches a platform only through `src/server/platforms/registry.ts`
(`platformFor(id, capability)`, `isPlatformEnabled`, `connectionFlow`).

To add a platform: build its engine, `module.ts`, host connection flow, and job
hooks, then add it to both installed lists and add its tests. This makes it
available in Root; customer capabilities must be wired and verified before
the module advertises them as supported.

The shared worker dispatches provider jobs through
`runEnabledPlatformJob()`; Facebook's implementations live in
`src/platforms/facebook/jobs.ts`. The remaining boundary work is to move
Facebook-specific ads actions, inbox actions, metric mappings and persistence
out of shared product paths. Until those interfaces and their tests exist,
another module must not claim those capabilities merely by adding a manifest.

# Platform adapters

`src/platforms/types.ts` holds provider-neutral contracts. Each adapter declares usable capabilities; unsupported operations are omitted. Customer navigation is generated separately from module manifests and entitlements.

The Facebook Page engine in `src/platforms/facebook/` supports OAuth URL and token exchange, profile/Page/ad-account discovery, Page text/link/remote-URL media posts with a first comment, remote status and deletion, Page conversation replies and comment moderation, configured Page insights, account-level Ads Insights, and ad status/budget updates. The host supplies Root-managed API endpoints, version, timeouts, fields, scopes, and encrypted credentials through `src/server/platforms/facebook.ts`. No credential is included in customer views. See the adapter's README for exact Graph operations and limits.

OAuth state, callback, token persistence, selection, scheduling, sync jobs, audit, and user authorization belong to the host application. The rebuild's Inbox manually syncs Page conversations and comments on locally published Page posts, allows replies and local resolve/reopen, and supports provider comment hide/unhide. Standard Messenger replies now require a stored visitor message within the Root-configured reply window (at most 24 hours); the server checks this again before contacting Meta. The neutral adapter exposes individual conversation messages and comments with remote IDs and authors; its comment method requires a known remote post ID and does not discover every remote post. It checks workspace entitlements, feature write access, Page scope, connection validity, and Root-configured inbox scopes on every action. New OAuth requests include the configured inbox read/write scope sets. A capability is not production-ready until those host operations are live tested. Facebook capabilities not yet handled include binary/resumable upload, Reels/Stories, Groups, complete inbox thread coverage, and ad creation.

The legacy implementation remains in the original app. This adapter does not import it or take operational values from scattered environment constants.
