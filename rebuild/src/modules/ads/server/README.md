# Ads read model

The rebuild Ads routes read `AdAccount` and every stored `AdInsight` level (`account`, `campaign`, `adset`, `ad`) through workspace-scoped queries. URL filters are bounded to workspace account IDs and UTC calendar dates. The default window is the latest 30 calendar days.

Summaries add daily spend, impressions, clicks, and numeric action values. Reach, CPP, frequency, and arbitrary provider `fields` use the latest daily row because they are snapshots or provider-specific values. CPC, CPM, and CTR are calculated from the selected-period spend/click/impression totals. Each object has a collapsed daily-details disclosure with every stored day's CPC, CPM, CPP, CTR, frequency, action JSON, and provider `fields`; this preserves values that should not be summed.

## Shared writes and copy

UI, REST and MCP creation and management use `modules/ads/management/server.ts`.
The service checks current membership, entitlements, write permission, selected
account, resource scope, provider availability/grants and exact provider-owned
consent before committing an intent. Campaigns, ad sets and ads start paused;
creatives remain unattached. Parent campaigns/ad sets must exist in the selected
account's stored history. Ad-set/ad creation refuses limited channel scope because
the parent cannot be bounded to a selected channel.

`PlatformAdsHost.configuredOperations(locale)` resolves the module-owned factory
through the neutral `platformAds` registry. Installed registration supplies the
Facebook factory; no provider branch is added to the registry or Ads service.
Existing callers receive the runtime English catalog. `withPlatformAdsLocale`
(or `withAdsErrorBoundary(operation, locale)`) carries English/French through
nested service calls; `adsServiceText` and error formatting use that same locale.
Each resolution returns a fresh host; configured factory failures do not silently
fall back to the static engine. No transport/provider requests occur while the
factory reads its Root copy. Frontend creation templates are still supplied by
`creationUi` separately; their consent must agree with the live preview.

The ledger preserves request ids per workspace/actor and hashes the normalized
account/operation payload. Reusing an id replays its recorded outcome; a changed
payload conflicts. Pending/uncertain operations hold their object identity,
including `@create-ad:<parentAdSetId>`, so an ambiguous creation cannot be blindly
resent. A missing remote id remains uncertain. Explicit confirmed recovery records
human attestation without contacting the provider or inventing a created identity.
Only a positively recorded provider success returns the `created` receipt.

Migration `20261031180000_rebuild_ads_ad_creation` extends the existing
operation-kind CHECK to `ad.create`; it preserves prior operations, records,
indexes, uniqueness and resolution rules. Its SHA-256 is
`1769fa24129e6d74119e84d0677a2baf0c935cb73a4e722ae0a443b7fbc7120f`.
Source/checksum and mocked recovery tests are distinct from PostgreSQL application,
provider writes, browser and production evidence. No migration was applied here.

## Integration outside this lane

- `rebuild/scripts/cutover-rehearsal.sh`: append the new migration name to
  `approved_migrations`, add `verify_migration` with the SHA above and apply the
  file after `20261030110000_rebuild_ads_creative_creation`. Extend the migration
  history refusal placeholders/USING list to include the new migration (the
  current query only checks its first 22 parameters despite a longer USING list).
  Add a post-apply CHECK/valid-invalid operation probe. Update the approved set
  and pin/order assertions in `tests/cutover-rehearsal.test.ts` together.
- `src/modules/ads/ui/campaigns/CampaignsScreen.tsx`,
  `src/app/api/ads/management/route.ts` and `src/modules/ads/mcp.ts`: pass the
  resolved customer locale into
  `withAdsErrorBoundary(operation, locale)` or wrap the complete service call in
  `withPlatformAdsLocale(locale, operation)`. Do so for both preview and apply;
  exact consent from another locale must not be silently accepted. The new scope
  defaults to English until callers opt in. The UI directories and transport
  handlers were outside this lane.
- Platform-owned `creationUi` and UI forms should consume the live management
  preview for confirmation. The independent creation template catalog is not
  synchronized automatically when Root changes `meta.adsCopy` consent templates.
- `src/modules/ads/management/server.ts`: recovery currently checks account
  visibility but does not repeat the unrestricted-channel requirement used for
  ad/ad-set creation. Review/enforce the stored operation scope before allowing
  a channel-limited manager to release a held creation. This existing gap was
  observed in source, not exercised against PostgreSQL.
- Architecture/Ads parity/handoff documents must record the source changes and
  pending migration rehearsal/application and locale entry-point integration.

No new Root keys; existing `meta.adsCopy` and Ads customer catalogs are consumed.
