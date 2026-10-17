CREATE TABLE rebuild_facebook_media_deletions (
  id text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "mediaStepId" text NOT NULL,
  "operationId" text NOT NULL,
  "postId" text NOT NULL,
  "postTargetId" text NOT NULL,
  "targetId" text NOT NULL,
  "remoteTargetId" text NOT NULL,
  "remotePhotoId" text NOT NULL,
  "actorId" text NOT NULL,
  state text NOT NULL DEFAULT 'started',
  "receiptAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rebuild_facebook_media_deletions_workspace_fk
    FOREIGN KEY ("workspaceId") REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT rebuild_facebook_media_deletions_id_length_check
    CHECK (char_length(id) BETWEEN 1 AND 2048),
  CONSTRAINT rebuild_facebook_media_deletions_binding_length_check
    CHECK (
      char_length("workspaceId") BETWEEN 1 AND 2048 AND
      char_length("mediaStepId") BETWEEN 1 AND 2048 AND
      char_length("operationId") BETWEEN 1 AND 2048 AND
      char_length("postId") BETWEEN 1 AND 2048 AND
      char_length("postTargetId") BETWEEN 1 AND 2048 AND
      char_length("targetId") BETWEEN 1 AND 2048 AND
      char_length("remoteTargetId") BETWEEN 1 AND 2048 AND
      char_length("remotePhotoId") BETWEEN 1 AND 2048 AND
      char_length("actorId") BETWEEN 1 AND 2048
    ),
  CONSTRAINT rebuild_facebook_media_deletions_no_control_chars_check
    CHECK (
      id !~ '[[:cntrl:]]' AND "workspaceId" !~ '[[:cntrl:]]' AND
      "mediaStepId" !~ '[[:cntrl:]]' AND "operationId" !~ '[[:cntrl:]]' AND
      "postId" !~ '[[:cntrl:]]' AND "postTargetId" !~ '[[:cntrl:]]' AND
      "targetId" !~ '[[:cntrl:]]' AND "remoteTargetId" !~ '[[:cntrl:]]' AND
      "remotePhotoId" !~ '[[:cntrl:]]' AND "actorId" !~ '[[:cntrl:]]'
    ),
  CONSTRAINT rebuild_facebook_media_deletions_state_check
    CHECK ((state IN ('started', 'uncertain', 'confirmed', 'rejected')) IS TRUE),
  CONSTRAINT rebuild_facebook_media_deletions_receipt_check
    CHECK ((
      (state IN ('started', 'uncertain') AND "receiptAt" IS NULL) OR
      (state IN ('confirmed', 'rejected') AND "receiptAt" IS NOT NULL)
    ) IS TRUE),
  CONSTRAINT rebuild_facebook_media_deletions_updated_check
    CHECK (("updatedAt" >= "createdAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt")) IS TRUE)
);

-- Rejected requests can be explicitly tried again. Started, uncertain and confirmed rows
-- reserve the exact known photo identity, preventing concurrent or duplicate cleanup.
CREATE UNIQUE INDEX rebuild_facebook_media_deletions_active_photo_unique
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId")
  WHERE state <> 'rejected';

CREATE INDEX rebuild_facebook_media_deletions_workspace_updated_idx
  ON rebuild_facebook_media_deletions ("workspaceId", "updatedAt" DESC, id DESC);

CREATE INDEX rebuild_facebook_media_deletions_step_history_idx
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId", "createdAt" DESC, id DESC);

CREATE FUNCTION rebuild_facebook_media_deletions_binding_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."workspaceId", NEW."mediaStepId", NEW."operationId", NEW."postId",
         NEW."postTargetId", NEW."targetId", NEW."remoteTargetId", NEW."remotePhotoId", NEW."actorId", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD.id, OLD."workspaceId", OLD."mediaStepId", OLD."operationId", OLD."postId",
         OLD."postTargetId", OLD."targetId", OLD."remoteTargetId", OLD."remotePhotoId", OLD."actorId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Facebook media deletion binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rebuild_facebook_media_deletions_binding_immutable_trigger
  BEFORE UPDATE ON rebuild_facebook_media_deletions
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_media_deletions_binding_immutable();
