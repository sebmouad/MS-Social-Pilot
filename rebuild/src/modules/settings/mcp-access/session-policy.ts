/** Account and credential management are session authority, never delegable bearer-key grants. */
export const SESSION_ONLY_MCP_FEATURES: ReadonlySet<string> = new Set(['settings/account', 'settings/mcp']);
