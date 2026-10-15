# Ads read model

The rebuild Ads routes read `AdAccount` and every stored `AdInsight` level (`account`, `campaign`, `adset`, `ad`) through workspace-scoped queries. URL filters are bounded to workspace account IDs and UTC calendar dates. The default window is the latest 30 calendar days.

Summaries add daily spend, impressions, clicks, and numeric action values. Reach, CPP, frequency, and arbitrary provider `fields` use the latest daily row because they are snapshots or provider-specific values. CPC, CPM, and CTR are calculated from the selected-period spend/click/impression totals. Each object has a collapsed daily-details disclosure with every stored day's CPC, CPM, CPP, CTR, frequency, action JSON, and provider `fields`; this preserves values that should not be summed.

Status and budget edits are read-only. The Facebook adapter has low-level update methods, but this rebuild does not provide workspace credential retrieval, permission checks for `ads_management`, or an authenticated mutation route. UI actions must remain unavailable until that service boundary exists.
