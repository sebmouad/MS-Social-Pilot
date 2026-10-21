import { ADS_MCP } from '../mcp';
import { keyToolEndpoint } from '@/modules/integrations/server/rest-tools';
/** Thin key-auth entry; all Ads services and credential rules are shared. */
export const adsKeyEndpoint = keyToolEndpoint(ADS_MCP);
