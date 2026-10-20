# Channel groups and profile labels

Implemented on `codex/page-profiles`; no deployment or database application.

Settings owns `src/modules/settings/channel-profiles/` (contracts, Root config,
shared authorization/persistence service, HTTP and MCP) and `ui/profiles/`.
`/settings/profiles` is reached from Connections, inherits its feature gate and
permits writes only for current owners/admins. New routes remain thin.
English/French use the request language, matching the existing localized slices.
Shared buttons, form fields and `useConfirm` own interaction primitives.

Groups reuse legacy `page_groups` and `page_group_targets`, preserving names,
colors and membership. Create/replace requires at least one selected accessible
channel. Delete retains channels/posts and refuses groups referenced by content
mix scheduling rules, preventing the legacy foreign-key cascade. Editing/deleting
a group with any unavailable member is refused; restore selection first. Read
results include only accessible selected members and omit wholly hidden groups.
This deliberately prevents a scoped key from replacing/deleting hidden members.

Profile labels are customer-owned strings on a channel, independent of provider
categories, provider channel names and Publishing post labels. Empty lists clear
labels. The editor uses commas as separators; commas/control characters inside
individual labels are rejected. Label/name counts and lengths are bounded by
`settings.channelProfilesPolicy`, declared in Settings' owning `config.ts` and
consumed by reads/writes. Existing team transaction limits remain in use. The
central registry is unchanged.

Migration: `prisma/migrations/20261029100000_rebuild_channel_profiles/migration.sql`
adds `rebuild_channel_profiles(targetId, labels text[])`. Target deletion cascades
its labels; group storage already exists. This is a raw-SQL compatibility table,
with no generated-client dependency. It has not been applied or rehearsed.
Rehearse it in the approved isolated cutover path before release. New profile
labels still need explicit coverage in the Settings archive/export inventory;
erasure through target deletion already uses the FK cascade. Retain disconnects
retain labels, while delete disconnects remove them with the channel.

Every service call reloads active identity, membership, entitlements and resource
scope. Writes lock workspace/actor rows, refuse suspension/purge, acquire the
shared selected-resource locks, recheck current authority and selected channels,
and commit mutation plus workspace activity audit atomically. Restricted MCP
keys carry an additional channel ceiling. No provider branching is introduced.

`list_channel_profiles`, `save_channel_group`, `delete_channel_group` and
`set_channel_profile_labels` call this same service. HTTP GET/POST at
`/settings/profiles/operations` use authenticated workspace context, no-store
responses, strict payloads, and same-origin writes. Delete confirmation is
`DELETE CHANNEL GROUP <id>`. Reads can be consumed internally under the current
Publishing/Analytics feature rather than granting Settings management authority.

Publishing's composer shortcut replaces its destination selection with the
current available members. The Posts channel filter includes groups with a
`channel-group:<id>` value; the shared Publishing read query resolves it under
current scope for Posts, exports and MCP lists. Missing/deleted groups yield an
empty filter and an unavailable indication, never “all”. Existing whole-post
visibility checks still exclude mixed posts containing hidden destinations.
Calendar and Queue group filters remain outside this slice.

Analytics' overview shortcut changes only the form's channel checkboxes; Apply
persists the explicit channel IDs using the existing authorized read service.
Ad accounts and dates are retained. Explorer and other Analytics subpages are
not changed. Both pickers show available profile labels beside channel names.
The shortcuts are optional enrichment: profile reads failing do not block the
existing individual-channel workflow; Settings reports Not available instead.

Evidence: focused service, HTTP/MCP dispatch, DOM interaction, localized markup,
Publishing query and existing composer/Analytics regression tests. No database,
real browser/theme/viewport, live-provider or production proof. Watermark settings
and shared image transformation remain open; no setting is advertised as applied.

Verification in this worktree: 71 tests passed across nine focused Vitest files,
including both new channel-profile files, raw SQL guard, Publishing read/search,
Analytics page, composer UI/page and MCP resource scope. `npx tsc --noEmit -p .`
passed. The broader suite was interrupted after sandbox-blocked loopback socket
tests (`listen EPERM`) and the unchanged module-manifests assertion omitting
`/analytics/posts`; no full-suite pass is claimed. Analytics page mock updates
required by locale/profile loading were corrected and pass in the focused run.
The strict UI audit reports existing repository findings; no findings were in
the new profile files. Browser/app servers were not started for verification.
