import { describe, expect, it } from 'vitest';
import { baselineBlock } from './baseline-block';

const migration = baselineBlock('20261019030000_rebuild_facebook_native_journal');

describe('Facebook native journal migration', () => {
  it('adds a bounded child journal under the neutral publication claim', () => {
    expect(migration).toContain('CREATE TABLE "rebuild_facebook_native_journal"');
    expect(migration).toContain('PRIMARY KEY ("operationId")');
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "rebuild_publication_attempts"("workspaceId", "id") ON DELETE CASCADE');
    expect(migration).toContain('CREATE UNIQUE INDEX "rebuild_publication_attempts_workspaceId_id_key"');
    expect(migration).toContain('"payloadHash" ~ \'^[0-9a-f]{64}$\'');
    expect(migration).toContain('length("sourceFormatId") BETWEEN 1 AND 128');
    expect(migration).toContain('"ownerToken" UUID NOT NULL');
    expect(migration).not.toMatch(/REFERENCES "(posts|post_targets|targets|social_accounts)"/);
    expect(migration).not.toMatch(/facebook_native_attempts/i);
  });

  it('locks the parent claim before validating a live Facebook projection at insert', () => {
    expect(migration).toMatch(/WHERE "id" = NEW\."operationId" AND "workspaceId" = NEW\."workspaceId" FOR UPDATE/);
    expect(migration).toContain('parent_row."provider" <> \'facebook\'');
    expect(migration).toContain('parent_row."state" <> \'started\'');
    expect(migration).toContain('pt."status" = \'processing\'');
    expect(migration).toContain('pt."remotePostId" IS NULL');
    expect(migration).toContain('t."providerId" = NEW."remoteTargetId"');
    expect(migration).toContain('t."type" = \'page\' AND t."enabled" AND sa."provider" = \'facebook\'');
    expect(migration).toContain('t."enabled" AND sa."provider" = \'facebook\' AND sa."invalidatedAt" IS NULL');
    expect(migration).toContain('COALESCE(pt."formatId", p."format") = NEW."sourceFormatId"');
  });

  it('enforces append-only protocol evidence, irreversible confirmation and completed receipts', () => {
    for (const state of ['started', 'published', 'rejected', 'uncertain', 'confirmed', 'deleted']) {
      expect(migration).toContain(`'${state}'`);
    }
    for (const phase of ['video_create', 'upload_start', 'upload_transfer', 'reel_finish', 'story_finish', 'photo_upload', 'story_create']) {
      expect(migration).toContain(`'${phase}'`);
    }
    expect(migration).toContain('NEW."revision" <> OLD."revision" + 1');
    expect(migration).toContain('"remoteId" IS NULL OR "knownIds" @> jsonb_build_array("remoteId")');
    expect(migration).toContain('jsonb_array_elements(NEW."steps") AS s(v) WHERE s.v->\'confirmed\'');
    expect(migration).toContain('native journal remote identity is immutable once recorded');
    expect(migration).toContain('native journal protocol steps are append-only');
    expect(migration).toContain('native journal known identifiers are append-only and capped');
    expect(migration).toContain('native journal confirmations are irreversible');
    expect(migration).toContain('NEW."knownIds" @> jsonb_build_array(NEW."remoteId")');
    expect(migration).toContain('OLD."conflicted" AND NOT NEW."conflicted"');
    expect(migration).toContain('publication claim binding cannot change after native journal creation');
    expect(migration).toContain('NEW."revision" <> 0 OR NEW."state" <> \'started\'');
    expect(migration).toContain('("state" <> \'started\' OR "remoteId" IS NULL)');
    expect(migration).not.toContain('"revision" = 0 AND "knownIds" =');
    expect(migration).toContain("OLD.\"steps\"->i->'confirmed' = 'true'::jsonb AND NEW.\"steps\"->i->'confirmed' IS DISTINCT FROM 'true'::jsonb");
    expect(migration).toContain("((NEW.\"steps\"->i) - 'confirmed') IS DISTINCT FROM ((OLD.\"steps\"->i) - 'confirmed')");
    expect(migration).not.toContain('NEW."steps"->0 IS DISTINCT FROM OLD."steps"->0');
    expect(migration).toContain('IS DISTINCT FROM ARRAY[\'confirmed\', \'dispatched\', \'phase\']::text[]');
    expect(migration).toContain('(NEW."id", NEW."provider", NEW."workspaceId", NEW."postId"');
    expect(migration).toContain("(OLD.\"state\" = 'started' AND NEW.\"state\" IN ('started', 'published', 'rejected', 'uncertain'))");
    expect(migration).toContain("(OLD.\"state\" = 'uncertain' AND NEW.\"state\" IN ('uncertain', 'confirmed', 'deleted', 'published'))");
    expect(migration).toContain("(OLD.\"state\" = 'published' AND NEW.\"state\" IN ('published', 'uncertain', 'confirmed', 'deleted'))");
    expect(migration).toContain("(OLD.\"state\" = 'confirmed' AND NEW.\"state\" IN ('confirmed', 'uncertain', 'deleted'))");
    expect(migration).toContain("(OLD.\"state\" = 'rejected' AND NEW.\"state\" IN ('rejected', 'uncertain'))");
    expect(migration).toContain("(OLD.\"state\" = 'deleted' AND NEW.\"state\" = 'deleted')");
    expect(migration).toContain('deleted native journal protocol steps are immutable');
    expect(migration).toContain('OLD."state" IN (\'confirmed\', \'rejected\', \'deleted\')');
    expect(migration).toContain('jsonb_array_length(NEW."knownIds") > jsonb_array_length(OLD."knownIds") AND NOT NEW."conflicted"');
    expect(migration).toContain('late identifiers after a terminal outcome must mark the journal conflicted');
    expect(migration).toContain('Late facts after a verified, rejected, or deleted outcome are retained only with an irreversible conflict marker.');
    expect(migration).toContain('"createdAt" <= "updatedAt"');
    expect(migration).toContain('NEW."updatedAt" < NEW."createdAt"');
    expect(migration).toContain('"operationId" = btrim("operationId") AND "operationId" !~ \'[[:cntrl:]]\'');
    expect(migration).not.toContain('rebuild_facebook_native_journal_active');
    expect(migration).toContain("to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL");
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_journal"');
    expect(migration).toContain('EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write()');
  });

  it('maps each story format to its own provider protocol chain', () => {
    expect(migration).toContain("ELSIF NEW.\"format\" = 'story_photo' THEN expected := ARRAY['photo_upload', 'story_create'];");
    expect(migration).toContain("ELSE expected := ARRAY['upload_start', 'upload_transfer', 'story_finish']; END IF;");
    expect(migration).toContain('FOR UPDATE;\n  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM \'facebook\'');
  });

  it('is additive and contains no data rewrite or destructive table operation', () => {
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\s+FROM\b/i);
  });
});
