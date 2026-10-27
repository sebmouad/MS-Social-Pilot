-- Duplicating a campaign, ad set or ad (always created paused) is a journaled ads change like the others.
ALTER TABLE ads_management_operations DROP CONSTRAINT ads_operations_operation_kind;
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_operation_kind CHECK (
  "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create','creative.create','ad.create','object.copy')
);
