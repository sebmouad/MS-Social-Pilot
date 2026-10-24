import { z } from 'zod';

export const WORKSPACE_JOB_OWNER_POLICY_SCHEMA = z.enum(['any_active_owner', 'all_active_owners']);
export const WORKSPACE_JOB_OWNER_LIMIT_SCHEMA = z.number().int().min(1).max(1000);
export const WORKSPACE_JOB_ACCESS_DEFAULTS = { ownerPolicy: 'any_active_owner', ownerLimit: 100 } as const;
