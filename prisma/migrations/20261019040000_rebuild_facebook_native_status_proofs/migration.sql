-- Provider-owned observations of native publication status. This ledger is a
-- child of the existing publication claim and grants no dispatch authority.
CREATE TABLE "rebuild_facebook_native_status_proofs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "observedRevision" INTEGER NOT NULL,
  "appliedRevision" INTEGER,
  "payloadHash" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "accepted" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_status_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_facebook_native_status_proofs_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_parent_fkey"
    FOREIGN KEY ("workspaceId", "operationId") REFERENCES "rebuild_publication_attempts"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_operation_fkey"
    FOREIGN KEY ("operationId") REFERENCES "rebuild_facebook_native_journal"("operationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_shape_check" CHECK ((
    "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    length("workspaceId") BETWEEN 1 AND 2048 AND "workspaceId" = btrim("workspaceId") AND "workspaceId" !~ '[[:cntrl:]]' AND
    length("operationId") BETWEEN 1 AND 2048 AND "operationId" = btrim("operationId") AND "operationId" !~ '[[:cntrl:]]' AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    length("remoteId") BETWEEN 1 AND 2048 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]' AND
    length("actorId") BETWEEN 1 AND 2048 AND "actorId" = btrim("actorId") AND "actorId" !~ '[[:cntrl:]]' AND
    "observedRevision" >= 0 AND ("appliedRevision" IS NULL OR "appliedRevision" >= 0) AND
    "payloadHash" ~ '^[0-9a-f]{64}$' AND "format" IN ('video', 'reel') AND
    "outcome" IN ('published', 'scheduled', 'processing', 'failed', 'unknown') AND
    ("detail" IS NULL OR (length("detail") <= 128 AND "detail" !~ '[[:cntrl:]]')) AND
    (("accepted" AND "outcome" = 'published' AND "appliedRevision" IS NOT NULL AND
       "appliedRevision" = "observedRevision" + 1) OR
     (NOT "accepted" AND "appliedRevision" IS NULL))
  ) IS TRUE)
);

CREATE INDEX "rebuild_fb_native_proofs_workspace_operation_time_idx"
  ON "rebuild_facebook_native_status_proofs"("workspaceId", "operationId", "observedAt");
CREATE UNIQUE INDEX "rebuild_fb_native_proofs_accepted_revision_key"
  ON "rebuild_facebook_native_status_proofs"("operationId", "observedRevision")
  WHERE "accepted";

CREATE FUNCTION "rebuild_facebook_native_status_proofs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "rebuild_publication_attempts"%ROWTYPE;
  child_row "rebuild_facebook_native_journal"%ROWTYPE;
  expected text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'native status proofs are immutable';
  END IF;

  -- Preserve the shared claim's lock order: parent first, then provider child.
  SELECT * INTO parent_row FROM "rebuild_publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' THEN
    RAISE EXCEPTION 'native status proof requires its Facebook publication claim';
  END IF;

  SELECT * INTO child_row FROM "rebuild_facebook_native_journal"
    WHERE "operationId" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR child_row."workspaceId" IS DISTINCT FROM NEW."workspaceId" OR
     child_row."format" IS DISTINCT FROM NEW."format" OR
     child_row."payloadHash" IS DISTINCT FROM NEW."payloadHash" OR
     child_row."remoteTargetId" IS DISTINCT FROM NEW."remoteTargetId" OR
     child_row."remoteId" IS DISTINCT FROM NEW."remoteId" OR
     NEW."observedRevision" > child_row."revision" THEN
    RAISE EXCEPTION 'native status proof binding does not match its journal child';
  END IF;

  -- actorId is the Root observer recorded on this proof. The journal's actorId
  -- remains the immutable original publication actor and may be different.
  PERFORM 1 FROM "users"
    WHERE "id" = NEW."actorId" AND "isInstanceOwner" AND "disabledAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'native status proof requires an active installation owner';
  END IF;

  IF NEW."accepted" THEN
    IF NEW."appliedRevision" IS DISTINCT FROM child_row."revision" OR
       child_row."state" IS DISTINCT FROM 'confirmed' OR child_row."conflicted" OR
       child_row."remoteId" IS NULL OR child_row."knownIds" <> jsonb_build_array(child_row."remoteId") THEN
      RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
    END IF;
    IF child_row."format" = 'video' THEN expected := ARRAY['video_create'];
    ELSE expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish']; END IF;
    IF jsonb_typeof(child_row."steps") <> 'array' OR
       jsonb_array_length(child_row."steps") <> cardinality(expected) OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements(child_row."steps") WITH ORDINALITY AS s(value, n)
         WHERE s.value->>'phase' IS DISTINCT FROM expected[s.n::integer] OR
           s.value->'dispatched' IS DISTINCT FROM 'true'::jsonb OR
           s.value->'confirmed' IS DISTINCT FROM 'true'::jsonb
       ) THEN
      RAISE EXCEPTION 'accepted native status proof requires the complete confirmed protocol chain';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_status_proofs_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_status_proofs"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_status_proofs_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_status_proofs"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();
