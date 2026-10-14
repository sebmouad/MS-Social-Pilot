# Modular product architecture

## Product hierarchy

Use stable product keys without an `app/` prefix. The top-level modules are
`publishing`, `analytics` and `ads`; features live below them, for example
`publishing/calendar` and `publishing/posts`. `settings` is also a top-level
module for shared workspace features such as `settings/team` and
`settings/sharing`; connections and data export remain core services. Existing
public URLs such as `/calendar`, `/posts` and `/analytics`
remain valid; product keys do not dictate URL paths.

One registry must map each feature to its routes, navigation, dependencies and
plan entitlement. Root can include a feature in a plan and disable it for a
workspace or member. A route must enforce the same decision the navigation
uses. Turning a feature off must not delete its data; owned data remains
exportable and Root can restore access. Features that need Posts cannot remain
apparently usable if Posts is disabled.

## Platforms

Facebook is the initial platform. Every additional platform has a connector
with common operations (connect, discover selectable destinations, publish,
read available metrics, delete where supported), a declared capability set and
its own Root configuration. A platform is offered to a workspace only when
Root has enabled it, required credentials and approval are present, and its
plan includes it. An existing connection is retained when availability changes;
the app must never imply a missing metric is zero or that a remote operation is
supported when it is not.

The user-facing Connections screen shows available platforms and connected
channels. Root alone sees app keys, scopes, switches, provider approval and
technical errors. The user never sees an “Other networks” category, developer
app instructions, or a prompt to ask Root to enable a platform. A platform
that is not part of the workspace product is absent from connection actions.

## Current migration work

- `src/lib/modules.ts` already maps major modules to routes. Its historical
  `schedule` key needs a compatibility migration to the product key
  `publishing`; old stored switches and bookmarks must continue to work.
- `src/lib/networks/index.ts` has a common publishing connector contract, but
  Facebook and Instagram still use separate code paths. Consolidate capability
  declarations before changing publisher behavior.
- `Plan.features` is a string array. Add platform and subfeature entitlements
  through this field before introducing a new table, and preserve existing
  subscriptions while Root assigns the new catalogue.
- Root platform pages already own network keys. Connections currently lists
  unavailable platforms and exposes setup guidance; remove that presentation
  as the availability and entitlement gates are connected.

## Release checks for each migration

1. A member sees and can use only included features and platforms; hidden
   routes and APIs reject direct requests. Root's own configuration remains
   available in `/root`.
2. Existing posts, metrics and connections survive a switch or plan change.
   Queued work cannot silently publish to a disabled destination.
3. Exercise owner, member, client and cross-workspace roles; empty and
   populated desktop/phone views in English and French; connect, publish,
   reporting, disable and re-enable journeys.
4. Deploy a pinned commit and verify health and worker. Record provider limits
   in `QUALITY_AUDIT.md` rather than manufacturing parity.
