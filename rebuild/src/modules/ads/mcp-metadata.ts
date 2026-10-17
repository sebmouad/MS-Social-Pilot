/** Version-one MCP report protocol; runtime policy and services remain authoritative. */
export const ADS_MCP_MAX_PAGE_ITEMS = 200;
const reportFilters = {
  period: { type: 'string', description: 'Current report preset ID, or custom with start and end. Omit for the configured default.' },
  start: { type: 'string', description: 'Inclusive UTC calendar day, YYYY-MM-DD.' },
  end: { type: 'string', description: 'Inclusive UTC calendar day, YYYY-MM-DD.' },
  accountId: { type: 'string', description: 'One accessible, selected ad account; omit for all accessible accounts.' },
  level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Omit for every stored level. Levels overlap and must not be summed together.' },
  objectId: { type: 'string', description: 'Exact stored object ID. Requires an explicit accountId and level.' },
};

export const adsReportToolDefinitions = [
  {
    name: 'get_ads_report_rows',
    description: 'Read a bounded daily page of every stored scalar metric, action and additional field, with currency, report date and fetch provenance. Sensitive credential fields are explicitly redacted. Follow nextOffset until null; offsets are not a frozen snapshot. Current workspace/channel grants, Root byte/row limits and MCP result ceilings apply. No provider request.',
    inputSchema: { type: 'object', properties: { ...reportFilters, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: ADS_MCP_MAX_PAGE_ITEMS } }, additionalProperties: false },
  },
  {
    name: 'export_ads_report',
    description: 'Return a complete UTF-8 CSV of all matching stored daily Ads metrics, actions and additional fields. Sensitive credentials are redacted and string cells are protected against spreadsheet formulas. All levels are included unless filtered; never sum overlapping levels or currencies. Root byte/row limits and the MCP total-row ceiling apply. Oversized output is refused without a partial file. This read sends no provider request.',
    inputSchema: { type: 'object', properties: reportFilters, additionalProperties: false },
  },
];
