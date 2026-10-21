-- Add paused-ad creation to the existing request-id / open-object journal.
-- Preserve all recorded requests, receipts, states, indexes and resolution guards.
ALTER TABLE ads_management_operations DROP CONSTRAINT ads_operations_operation_kind;
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_operation_kind CHECK (
  "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create','creative.create','ad.create')
);
