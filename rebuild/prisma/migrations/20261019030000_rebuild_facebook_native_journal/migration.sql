-- Facebook native publishing receipts are a child of the neutral publication
-- claim. This journal stores bounded, content-free protocol evidence only.
CREATE UNIQUE INDEX "rebuild_publication_attempts_workspaceId_id_key"
  ON "rebuild_publication_attempts"("workspaceId", "id");

CREATE TABLE "rebuild_facebook_native_journal" (
  "operationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "sourceFormatId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "ownerToken" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'started',
  "knownIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "remoteId" TEXT,
  "conflicted" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_journal_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "rebuild_facebook_native_journal_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_journal_parent_fkey"
    FOREIGN KEY ("workspaceId", "operationId") REFERENCES "rebuild_publication_attempts"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_journal_binding_check" CHECK ((
    length("operationId") BETWEEN 1 AND 2048 AND
    length("workspaceId") BETWEEN 1 AND 2048 AND
    length("postId") BETWEEN 1 AND 2048 AND
    length("postTargetId") BETWEEN 1 AND 2048 AND
    length("targetId") BETWEEN 1 AND 2048 AND
    length("actorId") BETWEEN 1 AND 2048 AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND
    "operationId" = btrim("operationId") AND "operationId" !~ '[[:cntrl:]]' AND
    "workspaceId" = btrim("workspaceId") AND "workspaceId" !~ '[[:cntrl:]]' AND
    "postId" = btrim("postId") AND "postId" !~ '[[:cntrl:]]' AND
    "postTargetId" = btrim("postTargetId") AND "postTargetId" !~ '[[:cntrl:]]' AND
    "targetId" = btrim("targetId") AND "targetId" !~ '[[:cntrl:]]' AND
    "actorId" = btrim("actorId") AND "actorId" !~ '[[:cntrl:]]' AND
    "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    length("sourceFormatId") BETWEEN 1 AND 128 AND "sourceFormatId" = btrim("sourceFormatId") AND
    "sourceFormatId" !~ '[[:cntrl:]]' AND
    "format" IN ('video', 'reel', 'story_photo', 'story_video') AND
    "payloadHash" ~ '^[0-9a-f]{64}$' AND "revision" >= 0 AND
    ("remoteId" IS NULL OR (length("remoteId") BETWEEN 1 AND 2048 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]')) AND
    "createdAt" <= "updatedAt"
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_journal_state_check"
    CHECK ("state" IN ('started', 'published', 'rejected', 'uncertain', 'confirmed', 'deleted')),
  CONSTRAINT "rebuild_facebook_native_journal_json_check" CHECK ((
    jsonb_typeof("knownIds") = 'array' AND jsonb_typeof("steps") = 'array' AND
    ("state" <> 'started' OR "remoteId" IS NULL) AND
    ("remoteId" IS NULL OR "knownIds" @> jsonb_build_array("remoteId")) AND
    ("state" NOT IN ('published', 'confirmed', 'deleted') OR "remoteId" IS NOT NULL)
  ) IS TRUE)
);

CREATE INDEX "rebuild_facebook_native_journal_workspace_target_updated_idx"
  ON "rebuild_facebook_native_journal"("workspaceId", "targetId", "updatedAt");

CREATE FUNCTION "rebuild_facebook_native_journal_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "rebuild_publication_attempts"%ROWTYPE;
  expected text[];
  step jsonb;
  i integer;
  id_value text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0 OR NEW."state" <> 'started' OR NEW."remoteId" IS NOT NULL OR
       NEW."knownIds" <> '[]'::jsonb OR NEW."steps" <> '[]'::jsonb OR NEW."conflicted" THEN
      RAISE EXCEPTION 'native journal must begin empty and started';
    END IF;
    SELECT * INTO parent_row FROM "rebuild_publication_attempts"
      WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
    IF NOT FOUND OR parent_row."provider" <> 'facebook' OR parent_row."state" <> 'started' OR
       parent_row."postId" <> NEW."postId" OR parent_row."postTargetId" <> NEW."postTargetId" OR
       parent_row."targetId" <> NEW."targetId" OR parent_row."actorId" <> NEW."actorId" THEN
      RAISE EXCEPTION 'native journal binding does not match a live Facebook publication claim';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "posts" p
      JOIN "post_targets" pt ON pt."id" = NEW."postTargetId" AND pt."postId" = p."id" AND pt."targetId" = NEW."targetId"
      JOIN "targets" t ON t."id" = pt."targetId" AND t."workspaceId" = NEW."workspaceId"
      JOIN "social_accounts" sa ON sa."id" = t."socialAccountId" AND sa."workspaceId" = NEW."workspaceId"
      WHERE p."id" = NEW."postId" AND p."workspaceId" = NEW."workspaceId"
        AND pt."status" = 'processing'
        AND pt."remotePostId" IS NULL AND t."providerId" = NEW."remoteTargetId"
        AND t."type" = 'page' AND t."enabled" AND sa."provider" = 'facebook' AND sa."invalidatedAt" IS NULL
        AND COALESCE(pt."formatId", p."format") = NEW."sourceFormatId"
    ) THEN
      RAISE EXCEPTION 'native journal requires matching live Facebook page projections';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW."operationId", NEW."workspaceId", NEW."postId", NEW."postTargetId", NEW."targetId", NEW."actorId", NEW."remoteTargetId", NEW."format", NEW."sourceFormatId", NEW."payloadHash", NEW."ownerToken", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."operationId", OLD."workspaceId", OLD."postId", OLD."postTargetId", OLD."targetId", OLD."actorId", OLD."remoteTargetId", OLD."format", OLD."sourceFormatId", OLD."payloadHash", OLD."ownerToken", OLD."createdAt") THEN
    RAISE EXCEPTION 'native journal binding is immutable';
  END IF;
  SELECT * INTO parent_row FROM "rebuild_publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' OR
     parent_row."postId" IS DISTINCT FROM NEW."postId" OR parent_row."postTargetId" IS DISTINCT FROM NEW."postTargetId" OR
     parent_row."targetId" IS DISTINCT FROM NEW."targetId" OR parent_row."actorId" IS DISTINCT FROM NEW."actorId" THEN
    RAISE EXCEPTION 'native journal update binding does not match its Facebook publication claim';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'native journal revision must advance by one'; END IF;
  IF OLD."conflicted" AND NOT NEW."conflicted" THEN RAISE EXCEPTION 'native journal conflict is irreversible'; END IF;
  IF NOT (
    (OLD."state" = 'started' AND NEW."state" IN ('started', 'published', 'rejected', 'uncertain')) OR
    (OLD."state" = 'uncertain' AND NEW."state" IN ('uncertain', 'confirmed', 'deleted', 'published')) OR
    (OLD."state" = 'published' AND NEW."state" IN ('published', 'uncertain', 'confirmed', 'deleted')) OR
    (OLD."state" = 'confirmed' AND NEW."state" IN ('confirmed', 'uncertain', 'deleted')) OR
    (OLD."state" = 'rejected' AND NEW."state" IN ('rejected', 'uncertain')) OR
    (OLD."state" = 'deleted' AND NEW."state" = 'deleted')
  ) THEN RAISE EXCEPTION 'invalid native journal state transition'; END IF;
  IF OLD."remoteId" IS NOT NULL AND NEW."remoteId" IS DISTINCT FROM OLD."remoteId" THEN
    RAISE EXCEPTION 'native journal remote identity is immutable once recorded';
  END IF;
  IF OLD."state" = 'deleted' AND NEW."steps" IS DISTINCT FROM OLD."steps" THEN
    RAISE EXCEPTION 'deleted native journal protocol steps are immutable';
  END IF;
  -- Late facts after a verified, rejected, or deleted outcome are retained only with an irreversible conflict marker.
  IF OLD."state" IN ('confirmed', 'rejected', 'deleted') AND
     jsonb_array_length(NEW."knownIds") > jsonb_array_length(OLD."knownIds") AND NOT NEW."conflicted" THEN
    RAISE EXCEPTION 'late identifiers after a terminal outcome must mark the journal conflicted';
  END IF;
  IF NEW."updatedAt" < OLD."updatedAt" THEN RAISE EXCEPTION 'native journal timestamp cannot move backwards'; END IF;
  IF NEW."updatedAt" < NEW."createdAt" THEN RAISE EXCEPTION 'native journal update cannot precede creation'; END IF;

  IF NEW."format" = 'video' THEN expected := ARRAY['video_create'];
  ELSIF NEW."format" = 'reel' THEN expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish'];
  ELSIF NEW."format" = 'story_photo' THEN expected := ARRAY['photo_upload', 'story_create'];
  ELSE expected := ARRAY['upload_start', 'upload_transfer', 'story_finish']; END IF;
  IF jsonb_typeof(NEW."steps") <> 'array' OR jsonb_array_length(NEW."steps") > cardinality(expected) THEN
    RAISE EXCEPTION 'native journal steps exceed protocol';
  END IF;
  FOR i IN 0..jsonb_array_length(NEW."steps") - 1 LOOP
    step := NEW."steps" -> i;
    IF jsonb_typeof(step) <> 'object' OR
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(step) AS keys(key)) IS DISTINCT FROM ARRAY['confirmed', 'dispatched', 'phase']::text[] OR
       step->>'phase' IS DISTINCT FROM expected[i + 1] OR jsonb_typeof(step->'dispatched') <> 'boolean' OR
       step->'dispatched' <> 'true'::jsonb OR jsonb_typeof(step->'confirmed') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid native journal protocol step';
    END IF;
    IF i > 0 AND NEW."steps"->(i - 1)->'confirmed' <> 'true'::jsonb THEN
      RAISE EXCEPTION 'each native journal step requires prior confirmation';
    END IF;
    IF i < jsonb_array_length(OLD."steps") AND OLD."steps"->i->'confirmed' = 'true'::jsonb AND NEW."steps"->i->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'native journal confirmations are irreversible';
    END IF;
    IF i < jsonb_array_length(OLD."steps") AND ((NEW."steps"->i) - 'confirmed') IS DISTINCT FROM ((OLD."steps"->i) - 'confirmed') THEN
      RAISE EXCEPTION 'native journal step fields cannot be rewritten';
    END IF;
  END LOOP;
  IF jsonb_array_length(NEW."steps") < jsonb_array_length(OLD."steps") THEN
    RAISE EXCEPTION 'native journal protocol steps are append-only';
  END IF;

  IF jsonb_typeof(NEW."knownIds") <> 'array' OR jsonb_array_length(NEW."knownIds") > 16 OR
     jsonb_array_length(NEW."knownIds") < jsonb_array_length(OLD."knownIds") THEN
    RAISE EXCEPTION 'native journal known identifiers are append-only and capped';
  END IF;
  FOR i IN 0..jsonb_array_length(NEW."knownIds") - 1 LOOP
    id_value := NEW."knownIds"->>i;
    IF jsonb_typeof(NEW."knownIds"->i) <> 'string' OR id_value IS NULL OR
       length(id_value) NOT BETWEEN 1 AND 2048 OR id_value <> btrim(id_value) OR id_value ~ '[[:cntrl:]]' OR
       (i < jsonb_array_length(OLD."knownIds") AND NEW."knownIds"->i IS DISTINCT FROM OLD."knownIds"->i) OR
       EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW."knownIds") WITH ORDINALITY e(v,n) WHERE e.v = id_value AND e.n < i + 1) THEN
      RAISE EXCEPTION 'invalid or repeated native journal identifier';
    END IF;
  END LOOP;

  IF NEW."state" IN ('published', 'confirmed', 'deleted') THEN
    IF jsonb_array_length(NEW."steps") <> cardinality(expected) OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."steps") AS s(v) WHERE s.v->'confirmed' <> 'true'::jsonb) OR
       NEW."remoteId" IS NULL OR NOT (NEW."knownIds" @> jsonb_build_array(NEW."remoteId")) THEN
      RAISE EXCEPTION 'completed native journal requires fully confirmed protocol and known remote id';
    END IF;
  END IF;
  IF NEW."state" = 'started' AND NEW."remoteId" IS NOT NULL THEN RAISE EXCEPTION 'started native journal cannot have remote id'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_journal_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_journal"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_journal_guard"();

CREATE FUNCTION "rebuild_publication_attempts_native_binding_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."provider", NEW."workspaceId", NEW."postId", NEW."postTargetId", NEW."targetId", NEW."actorId")
     IS DISTINCT FROM
     (OLD."id", OLD."provider", OLD."workspaceId", OLD."postId", OLD."postTargetId", OLD."targetId", OLD."actorId") AND
     EXISTS (SELECT 1 FROM "rebuild_facebook_native_journal" j WHERE j."operationId" = OLD."id" AND j."workspaceId" = OLD."workspaceId") THEN
    RAISE EXCEPTION 'publication claim binding cannot change after native journal creation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_publication_attempts_native_binding_guard_trigger"
  BEFORE UPDATE ON "rebuild_publication_attempts"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_publication_attempts_native_binding_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_journal"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();
