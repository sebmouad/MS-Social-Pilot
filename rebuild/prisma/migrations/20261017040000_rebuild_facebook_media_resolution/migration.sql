-- Immutable operator attestations and delayed provider-result evidence for
-- Facebook's content-free multi-photo and staged-photo deletion journals.
ALTER TABLE rebuild_facebook_media_steps
  ADD COLUMN "attestedAt" TIMESTAMP(3),
  ADD COLUMN "attestedBy" TEXT;

ALTER TABLE rebuild_facebook_media_steps
  DROP CONSTRAINT rebuild_facebook_media_steps_state_check,
  DROP CONSTRAINT rebuild_facebook_media_steps_state_timestamps_check,
  DROP CONSTRAINT rebuild_facebook_media_steps_time_order_check,
  ADD CONSTRAINT rebuild_facebook_media_steps_state_check
    CHECK ("state" IN ('started', 'recorded', 'rejected', 'uncertain', 'attested_present', 'attested_absent', 'conflict')),
  ADD CONSTRAINT rebuild_facebook_media_steps_state_timestamps_check
    CHECK ((
      ("state" = 'started' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'recorded' AND "remoteId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'rejected' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NOT NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'uncertain' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'attested_present' AND "remoteId" IS NOT NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      ("state" = 'attested_absent' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      ("state" = 'conflict' AND ("remoteId" IS NULL OR "receiptAt" IS NOT NULL) AND "rejectedAt" IS NULL AND (("attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
    ) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_steps_time_order_check
    CHECK (("createdAt" <= "updatedAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("rejectedAt" IS NULL OR "rejectedAt" <= "updatedAt") AND ("attestedAt" IS NULL OR "attestedAt" <= "updatedAt")) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_steps_attestor_bound_check
    CHECK ("attestedBy" IS NULL OR (length("attestedBy") BETWEEN 1 AND 2048 AND "attestedBy" !~ '[[:cntrl:]]'));

ALTER TABLE rebuild_facebook_media_deletions
  ADD COLUMN "attestedAt" timestamptz,
  ADD COLUMN "attestedBy" text;

ALTER TABLE rebuild_facebook_media_deletions
  DROP CONSTRAINT rebuild_facebook_media_deletions_state_check,
  DROP CONSTRAINT rebuild_facebook_media_deletions_receipt_check,
  DROP CONSTRAINT rebuild_facebook_media_deletions_updated_check,
  ADD CONSTRAINT rebuild_facebook_media_deletions_state_check
    CHECK ((state IN ('started', 'uncertain', 'confirmed', 'rejected', 'attested_deleted', 'attested_present', 'conflict')) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_receipt_check
    CHECK ((
      (state IN ('started', 'uncertain') AND "receiptAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      (state IN ('confirmed', 'rejected') AND "receiptAt" IS NOT NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      (state IN ('attested_deleted', 'attested_present') AND "receiptAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      (state = 'conflict' AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND (("attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
    ) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_updated_check
    CHECK (("updatedAt" >= "createdAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("attestedAt" IS NULL OR "attestedAt" <= "updatedAt")) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_attestor_bound_check
    CHECK ("attestedBy" IS NULL OR (char_length("attestedBy") BETWEEN 1 AND 2048 AND "attestedBy" !~ '[[:cntrl:]]'));

DROP INDEX rebuild_facebook_media_deletions_active_photo_unique;
CREATE UNIQUE INDEX rebuild_facebook_media_deletions_active_photo_unique
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId")
  WHERE state NOT IN ('rejected', 'attested_present');

CREATE TABLE rebuild_facebook_media_resolutions (
  id text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "operationId" text NOT NULL,
  "mediaStepId" text NOT NULL,
  "deletionId" text,
  "postId" text NOT NULL,
  "postTargetId" text NOT NULL,
  "targetId" text NOT NULL,
  "remoteTargetId" text NOT NULL,
  "publicationActorId" text NOT NULL,
  "eventActorId" text,
  phase text NOT NULL,
  ordinal integer NOT NULL,
  source text NOT NULL,
  outcome text NOT NULL,
  "remoteId" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rebuild_facebook_media_resolutions_workspace_fk
    FOREIGN KEY ("workspaceId") REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT rebuild_facebook_media_resolutions_phase_check
    CHECK (((phase = 'photo' AND ordinal BETWEEN 1 AND 20 AND "deletionId" IS NULL) OR
            (phase = 'feed' AND ordinal = 0 AND "deletionId" IS NULL) OR
            (phase = 'delete' AND ordinal BETWEEN 1 AND 20 AND "deletionId" IS NOT NULL)) IS TRUE),
  CONSTRAINT rebuild_facebook_media_resolutions_source_check
    CHECK (source IN ('operator', 'provider')),
  CONSTRAINT rebuild_facebook_media_resolutions_outcome_check
    CHECK (outcome IN ('photo_present', 'photo_absent', 'feed_present', 'feed_absent', 'delete_deleted', 'delete_present', 'late_provider_receipt', 'late_provider_rejection', 'late_provider_uncertain')),
  CONSTRAINT rebuild_facebook_media_resolutions_binding_length_check
    CHECK (
      char_length(id) BETWEEN 1 AND 2048 AND
      char_length("workspaceId") BETWEEN 1 AND 2048 AND
      char_length("operationId") BETWEEN 1 AND 2048 AND
      char_length("mediaStepId") BETWEEN 1 AND 2048 AND
      ("deletionId" IS NULL OR char_length("deletionId") BETWEEN 1 AND 2048) AND
      char_length("postId") BETWEEN 1 AND 2048 AND
      char_length("postTargetId") BETWEEN 1 AND 2048 AND
      char_length("targetId") BETWEEN 1 AND 2048 AND
      char_length("remoteTargetId") BETWEEN 1 AND 2048 AND
      char_length("publicationActorId") BETWEEN 1 AND 2048 AND
      ("eventActorId" IS NULL OR char_length("eventActorId") BETWEEN 1 AND 2048) AND
      ("remoteId" IS NULL OR char_length("remoteId") BETWEEN 1 AND 2048)
    ),
  CONSTRAINT rebuild_facebook_media_resolutions_control_chars_check
    CHECK (
      id !~ '[[:cntrl:]]' AND "workspaceId" !~ '[[:cntrl:]]' AND "operationId" !~ '[[:cntrl:]]' AND
      "mediaStepId" !~ '[[:cntrl:]]' AND ("deletionId" IS NULL OR "deletionId" !~ '[[:cntrl:]]') AND
      "postId" !~ '[[:cntrl:]]' AND "postTargetId" !~ '[[:cntrl:]]' AND "targetId" !~ '[[:cntrl:]]' AND
      "remoteTargetId" !~ '[[:cntrl:]]' AND "publicationActorId" !~ '[[:cntrl:]]' AND
      ("eventActorId" IS NULL OR "eventActorId" !~ '[[:cntrl:]]') AND ("remoteId" IS NULL OR "remoteId" !~ '[[:cntrl:]]')
    ),
  CONSTRAINT rebuild_facebook_media_resolutions_actor_check
    CHECK (((source = 'operator' AND "eventActorId" IS NOT NULL AND outcome IN ('photo_present', 'photo_absent', 'feed_present', 'feed_absent', 'delete_deleted', 'delete_present')) OR
            (source = 'provider' AND "eventActorId" IS NULL AND outcome IN ('late_provider_receipt', 'late_provider_rejection', 'late_provider_uncertain'))) IS TRUE),
  CONSTRAINT rebuild_facebook_media_resolutions_remote_id_check
    CHECK (((outcome IN ('photo_present', 'feed_present', 'late_provider_receipt') AND "remoteId" IS NOT NULL) OR
            (outcome NOT IN ('photo_present', 'feed_present', 'late_provider_receipt') AND "remoteId" IS NULL)) IS TRUE)
);

CREATE INDEX rebuild_facebook_media_resolutions_operation_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "operationId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_facebook_media_resolutions_step_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "mediaStepId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_facebook_media_resolutions_deletion_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "deletionId", "createdAt" DESC, id DESC)
  WHERE "deletionId" IS NOT NULL;

CREATE FUNCTION rebuild_facebook_media_resolutions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Facebook media resolution history is immutable';
END;
$$;

CREATE TRIGGER rebuild_facebook_media_resolutions_immutable_trigger
  -- Workspace erasure owns deletion of scoped rows; normal module code has no delete path.
  BEFORE UPDATE ON rebuild_facebook_media_resolutions
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_media_resolutions_immutable();
