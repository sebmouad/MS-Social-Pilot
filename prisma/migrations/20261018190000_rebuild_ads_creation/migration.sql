-- Extend the same durable journal; do not create a separate creation write path.
ALTER TABLE ads_management_operations
  DROP CONSTRAINT "ads_management_operations_operationType_check";
ALTER TABLE ads_management_operations
  ADD CONSTRAINT ads_operations_operation_kind CHECK (
    "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create')
  );
