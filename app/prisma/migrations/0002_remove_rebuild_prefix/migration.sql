-- MS Social Pilot — Remove legacy rebuild_ prefix from tables, indexes, constraints, triggers, and functions

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- If both legacy workspace_exports and rebuild_workspace_exports exist, drop the unused legacy table first
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rebuild_workspace_exports'
  ) THEN
    DROP TABLE IF EXISTS public.workspace_exports CASCADE;
  END IF;

  -- 1. Rename tables starting with rebuild_
  FOR rec IN
    SELECT c.relname AS old_name, substring(c.relname FROM 9) AS new_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'rebuild\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', rec.old_name, rec.new_name);
  END LOOP;

  -- 2. Rename indexes starting with rebuild_
  FOR rec IN
    SELECT c.relname AS old_name, substring(c.relname FROM 9) AS new_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname LIKE 'rebuild\_%' ESCAPE '\'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'public' AND c2.relname = rec.new_name
    ) THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', rec.old_name, rec.new_name);
    END IF;
  END LOOP;

  -- 3. Rename table constraints starting with rebuild_
  FOR rec IN
    SELECT cl.relname AS table_name, con.conname AS old_name, substring(con.conname FROM 9) AS new_name
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND con.conname LIKE 'rebuild\_%' ESCAPE '\'
      AND con.contype IN ('f', 'c')
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', rec.table_name, rec.old_name, rec.new_name);
  END LOOP;

  -- 4. Rename triggers starting with rebuild_
  FOR rec IN
    SELECT cl.relname AS table_name, tg.tgname AS old_name, substring(tg.tgname FROM 9) AS new_name
    FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND tg.tgname LIKE 'rebuild\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TRIGGER %I ON public.%I RENAME TO %I', rec.old_name, rec.table_name, rec.new_name);
  END LOOP;

  -- 5. Rename functions starting with rebuild_
  FOR rec IN
    SELECT p.proname AS old_name, substring(p.proname FROM 9) AS new_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rebuild\_%' ESCAPE '\'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p2 JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
      WHERE n2.nspname = 'public' AND p2.proname = rec.new_name
    ) THEN
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', rec.old_name, rec.args, rec.new_name);
    END IF;
  END LOOP;
END $$;

-- Refresh trigger function bodies that referenced table names directly
CREATE OR REPLACE FUNCTION "facebook_native_journal_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "publication_attempts"%ROWTYPE;
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
    SELECT * INTO parent_row FROM "publication_attempts"
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
  SELECT * INTO parent_row FROM "publication_attempts"
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

CREATE OR REPLACE FUNCTION "publication_attempts_native_binding_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."provider", NEW."workspaceId", NEW."postId", NEW."postTargetId", NEW."targetId", NEW."actorId")
     IS DISTINCT FROM
     (OLD."id", OLD."provider", OLD."workspaceId", OLD."postId", OLD."postTargetId", OLD."targetId", OLD."actorId") AND
     EXISTS (SELECT 1 FROM "facebook_native_journal" j WHERE j."operationId" = OLD."id" AND j."workspaceId" = OLD."workspaceId") THEN
    RAISE EXCEPTION 'publication claim binding cannot change after native journal creation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "facebook_native_status_proofs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "publication_attempts"%ROWTYPE;
  child_row "facebook_native_journal"%ROWTYPE;
  expected text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'native status proofs are immutable';
  END IF;

  -- Preserve the shared claim's lock order: parent first, then provider child.
  SELECT * INTO parent_row FROM "publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' THEN
    RAISE EXCEPTION 'native status proof requires its Facebook publication claim';
  END IF;

  SELECT * INTO child_row FROM "facebook_native_journal"
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

CREATE OR REPLACE FUNCTION public.queue_export_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.export_file_cleanups (id, "workspaceId", "mediaRoot")
    VALUES (OLD.id, OLD."workspaceId", OLD."mediaRoot") ON CONFLICT (id) DO NOTHING;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION "facebook_native_status_proofs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "publication_attempts"%ROWTYPE;
  child_row "facebook_native_journal"%ROWTYPE;
  expected text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'native status proofs are immutable';
  END IF;

  -- Preserve the shared claim's lock order: parent first, then provider child.
  SELECT * INTO parent_row FROM "publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' THEN
    RAISE EXCEPTION 'native status proof requires its Facebook publication claim';
  END IF;

  SELECT * INTO child_row FROM "facebook_native_journal"
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
       child_row."remoteId" IS NULL THEN
      RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
    END IF;
    IF child_row."format" IN ('video', 'reel') THEN
      IF child_row."knownIds" <> jsonb_build_array(child_row."remoteId") THEN
        RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
      END IF;
    ELSIF jsonb_typeof(child_row."knownIds") IS DISTINCT FROM 'array' OR
          jsonb_array_length(child_row."knownIds") <> 2 OR
          NOT (child_row."knownIds" @> jsonb_build_array(child_row."remoteId")) THEN
      RAISE EXCEPTION 'accepted native Story proof requires exactly the staged media and the confirmed final Story identity';
    END IF;
    IF child_row."format" = 'video' THEN expected := ARRAY['video_create'];
    ELSIF child_row."format" = 'reel' THEN expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish'];
    ELSIF child_row."format" = 'story_photo' THEN expected := ARRAY['photo_upload', 'story_create'];
    ELSE expected := ARRAY['upload_start', 'upload_transfer', 'story_finish']; END IF;
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

CREATE OR REPLACE FUNCTION "facebook_native_schedule_changes_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  journal_row "facebook_native_journal"%ROWTYPE;
BEGIN
  SELECT * INTO journal_row FROM "facebook_native_journal"
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

-- Migrate worker identity prefix from rebuild- to worker-
UPDATE public.worker_heartbeats SET "workerId" = 'worker-' || substring("workerId" FROM 9) WHERE "workerId" LIKE 'rebuild-%';
UPDATE public.sync_runs SET owner = 'worker-' || substring(owner FROM 9) WHERE owner LIKE 'rebuild-%';
