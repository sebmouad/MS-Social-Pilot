-- Provider submission is a durable receipt state that precedes local projection.
-- Preserve the prior state/timestamp branches verbatim and extend them additively.
ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_state_check",
  ADD CONSTRAINT "rebuild_publication_attempts_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'receipt_recorded', 'projected', 'rejected', 'attested_absent', 'submitted'));

ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_reason_check",
  ADD CONSTRAINT "rebuild_publication_attempts_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('provider_rejected', 'outcome_unknown', 'provider_receipt', 'external_human_attestation', 'provider_submission'));

ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_state_timestamps_check",
  ADD CONSTRAINT "rebuild_publication_attempts_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'outcome_unknown' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'receipt_recorded' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'projected' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NOT NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'rejected' AND "reason" = 'provider_rejected' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'attested_absent' AND "reason" = 'external_human_attestation' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)
      OR ("state" = 'submitted' AND "reason" = 'provider_submission' AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
    ) IS TRUE);
