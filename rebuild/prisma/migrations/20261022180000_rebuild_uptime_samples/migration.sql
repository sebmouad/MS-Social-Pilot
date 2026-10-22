-- Persistence idempotency for sampled minutes; daily totals remain legacy-compatible.
CREATE TABLE rebuild_uptime_samples (
  minute TIMESTAMP(3) NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('app', 'worker')),
  PRIMARY KEY (minute, component)
);

CREATE TABLE rebuild_monitoring_deliveries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unavailable', 'uncertain')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX rebuild_monitoring_deliveries_status_created ON rebuild_monitoring_deliveries(status, "createdAt");
