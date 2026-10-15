# Ads read model

The rebuild Ads routes read `AdAccount` and every stored `AdInsight` level (`account`, `campaign`, `adset`, `ad`) through workspace-scoped queries. URL filters are bounded to workspace account IDs and UTC calendar dates. The default window is the latest 30 calendar days.

Summaries add daily spend, impressions, clicks, and numeric action values. Reach, CPP, frequency, and arbitrary provider `fields` use the latest daily row because they are snapshots or provider-specific values. CPC, CPM, and CTR are calculated from the selected-period spend/click/impression totals. Each object has a collapsed daily-details disclosure with every stored day's CPC, CPM, CPP, CTR, frequency, action JSON, and provider `fields`; this preserves values that should not be summed.

Campaign creation is available to workspace owners and admins when the Root ads-management switch, Facebook platform switch, workspace feature entitlement, write permission, connected enabled ad account, and recorded `ads_management` grant are all present. The first creation path creates a paused campaign with a selected objective; it does not launch delivery or create ad sets, creatives, or ads. Each request requires an exact typed confirmation and records an audit event without credentials. Existing status and budget edits use the same server-side boundary and confirmation pattern.
