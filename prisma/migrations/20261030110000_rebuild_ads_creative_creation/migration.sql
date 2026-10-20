-- Extend the existing durable creation journal; no automatic replay of held writes.
ALTER TABLE ads_management_operations DROP CONSTRAINT ads_operations_operation_kind;
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_operation_kind CHECK (
  "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create','creative.create')
);
ALTER TABLE ads_management_operations DROP CONSTRAINT "ads_management_operations_objectType_check";
ALTER TABLE ads_management_operations ADD CONSTRAINT "ads_management_operations_objectType_check" CHECK (
  "objectType" IN ('campaign','adset','ad','creative')
);
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_creative_shape CHECK (
  ("objectType" = 'creative') = ("operationType" = 'creative.create')
);
-- Durable intermediate receipts are independently committed to the existing audit journal.
CREATE INDEX ads_creation_receipt_lookup ON root_activities ((detail->>'workspaceId'), (detail->>'operationId'), "createdAt" DESC)
  WHERE action = 'ads.creation_receipt';
