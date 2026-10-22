-- Additive report evidence and bounded manual download receipts. Existing
-- report_templates/report_schedules, recipients and aiRecap are preserved.
CREATE TABLE report_runs (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "scheduleId" TEXT REFERENCES report_schedules(id) ON DELETE SET NULL,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manual','scheduled')),
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "claimToken" TEXT NOT NULL,
  "requestHash" CHAR(64) CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$'),
  "periodStart" TEXT NOT NULL CHECK ("periodStart" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char("periodStart"::date,'YYYY-MM-DD') = "periodStart"),
  "periodEnd" TEXT NOT NULL CHECK ("periodEnd" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char("periodEnd"::date,'YYYY-MM-DD') = "periodEnd"),
  status TEXT NOT NULL CHECK (status IN ('claimed','generating','delivering','completed','partial','failed','uncertain','skipped')),
  "leaseUntil" TIMESTAMPTZ NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finishedAt" TIMESTAMPTZ,
  "rowCount" INTEGER CHECK ("rowCount" IS NULL OR "rowCount" >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  "failureReason" TEXT,
  deliveries JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliveries) = 'array'),
  "requestedById" TEXT,
  output JSONB CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  "outputExpiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("periodStart" <= "periodEnd"),
  CHECK (kind <> 'manual' OR "requestHash" IS NOT NULL),
  CHECK ((output IS NULL) = ("outputExpiresAt" IS NULL)),
  CHECK (output IS NULL OR (kind = 'manual' AND status = 'completed')),
  CHECK ((status IN ('claimed','generating','delivering')) = ("finishedAt" IS NULL))
);
CREATE INDEX report_runs_workspace_history ON report_runs ("workspaceId", "startedAt" DESC, id);
CREATE INDEX report_runs_channel_history ON report_runs ("workspaceId", "targetId", "startedAt" DESC, id);
CREATE INDEX report_runs_open_leases ON report_runs ("leaseUntil", id) WHERE status IN ('claimed','generating','delivering');
CREATE INDEX report_runs_output_expiry ON report_runs ("outputExpiresAt", id) WHERE output IS NOT NULL;
