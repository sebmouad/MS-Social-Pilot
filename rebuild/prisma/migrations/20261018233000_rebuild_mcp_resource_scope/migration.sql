-- NULL preserves pre-scope credential behavior; new credentials use a validated versioned ceiling.
ALTER TABLE "mcp_api_keys" ADD COLUMN "resourceScope" JSONB;
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_resource_scope_shape" CHECK (
  "resourceScope" IS NULL OR (
    jsonb_typeof("resourceScope") = 'object'
    AND "resourceScope" ?& ARRAY['version', 'mode']
    AND "resourceScope"->'version' = '1'::jsonb
    AND (("resourceScope"->>'mode' = 'all' AND NOT ("resourceScope" ? 'ids'))
      OR ("resourceScope"->>'mode' = 'selected' AND "resourceScope" ? 'ids' AND jsonb_typeof("resourceScope"->'ids') = 'array'))
  )
);
