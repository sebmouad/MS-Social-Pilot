-- Facebook native provider-held schedule changes (cancel / reschedule of a
-- published native Video) are child intents of the native journal. One row per
-- change, bound to the journal row, its workspace and the immutable remote id.
-- Content-free protocol evidence only. A repeat can never dispatch a second write.
CREATE UNIQUE INDEX "rebuild_facebook_native_journal_workspaceId_operationId_key"
  ON "rebuild_facebook_native_journal"("workspaceId", "operationId");

CREATE TABLE "rebuild_facebook_native_schedule_changes" (
  "changeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "publishOperationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "scheduledUnix" BIGINT,
  "remoteId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "ownerToken" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'started',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_pkey" PRIMARY KEY ("changeId"),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_journal_fkey"
    FOREIGN KEY ("workspaceId", "publishOperationId") REFERENCES "rebuild_facebook_native_journal"("workspaceId", "operationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_kind_check" CHECK ((
    ("kind" = 'cancel' AND "scheduledUnix" IS NULL AND "changeId" = "publishOperationId" || ':cancel') OR
    ("kind" = 'reschedule' AND "scheduledUnix" > 0 AND "changeId" = "publishOperationId" || ':reschedule:' || "scheduledUnix"::text)
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_bounds_check" CHECK ((
    length("changeId") BETWEEN 1 AND 4200 AND "changeId" !~ '[[:cntrl:]]' AND
    length("remoteId") BETWEEN 1 AND 128 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]' AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    "revision" >= 0 AND "createdAt" <= "updatedAt"
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_state_check"
    CHECK ("state" IN ('started', 'published', 'rejected', 'uncertain', 'deleted'))
);

CREATE INDEX "rebuild_facebook_native_schedule_changes_publish_idx"
  ON "rebuild_facebook_native_schedule_changes"("workspaceId", "publishOperationId", "createdAt");

CREATE FUNCTION "rebuild_facebook_native_schedule_changes_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  journal_row "rebuild_facebook_native_journal"%ROWTYPE;
BEGIN
  SELECT * INTO journal_row FROM "rebuild_facebook_native_journal"
    WHERE "operationId" = NEW."publishOperationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR journal_row."format" <> 'video' OR journal_row."remoteId" IS DISTINCT FROM NEW."remoteId" OR
     journal_row."remoteTargetId" <> NEW."remoteTargetId" THEN
    RAISE EXCEPTION 'schedule change does not match its native Video journal';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0 OR NEW."state" <> 'started' THEN
      RAISE EXCEPTION 'schedule change must begin started';
    END IF;
    IF journal_row."state" NOT IN ('published', 'confirmed') OR journal_row."conflicted" THEN
      RAISE EXCEPTION 'schedule change requires a published, unconflicted native Video';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."changeId", NEW."workspaceId", NEW."publishOperationId", NEW."kind", NEW."scheduledUnix", NEW."remoteId", NEW."remoteTargetId", NEW."ownerToken", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."changeId", OLD."workspaceId", OLD."publishOperationId", OLD."kind", OLD."scheduledUnix", OLD."remoteId", OLD."remoteTargetId", OLD."ownerToken", OLD."createdAt") THEN
    RAISE EXCEPTION 'schedule change binding is immutable';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'schedule change revision must advance by one'; END IF;
  IF NEW."updatedAt" < OLD."updatedAt" THEN RAISE EXCEPTION 'schedule change timestamp cannot move backwards'; END IF;
  IF NOT (
    OLD."state" = NEW."state" OR
    (OLD."state" = 'started' AND NEW."state" IN ('rejected', 'uncertain')) OR
    (OLD."state" = 'started' AND NEW."kind" = 'cancel' AND NEW."state" = 'deleted') OR
    (OLD."state" = 'started' AND NEW."kind" = 'reschedule' AND NEW."state" = 'published')
  ) THEN RAISE EXCEPTION 'invalid schedule change state transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_schedule_changes_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_schedule_changes"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_schedule_changes_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_schedule_changes"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();
