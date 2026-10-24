import { ANALYTICS_MCP } from '../mcp';
import { keyToolEndpoint } from '@/modules/integrations/server/rest-tools';
/** Thin key-auth entry; all Analytics services and credential rules are shared. */
export const analyticsKeyEndpoint = keyToolEndpoint(ANALYTICS_MCP);
