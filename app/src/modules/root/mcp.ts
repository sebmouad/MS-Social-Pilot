import { OperationError } from '@/lib/operation-error';
import { readRootApiUsage } from './server/api-usage';
import { readRootOperatorMonitoring, runRootOperatorMonitoring, testRootOperatorMonitoring } from './server/operator-monitoring';
export const rootMonitoringToolDefinitions = [
  { name: 'test_root_monitoring', description: 'Installation-owner only: queue a durable email and configured operator chat delivery test. Exact confirmation: TEST ROOT MONITORING. Review delivery receipts before repeating.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_api_usage', description: 'Installation-owner only: latest provider-reported API usage (rate-limit) readings per installed platform. Values are the platform’s own estimates and may be stale; they are not a quota guarantee. Optional providerId. Workspace keys cannot use this tool.', inputSchema: { type: 'object', properties: { providerId: { type: 'string', minLength: 1, maxLength: 80 }, locale: { type: 'string', enum: ['en', 'fr'] } }, additionalProperties: false } },
  { name: 'get_root_monitoring', description: 'Installation-owner only: bounded open alerts and recorded availability observations. Observation minutes do not guarantee continuous uptime. Workspace keys cannot use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'evaluate_root_monitoring', description: 'Installation-owner only: evaluate current signals, open/resolve alerts and record observed availability through the leased job runner. Exact confirmation: EVALUATE ROOT MONITORING. Does not restart services.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
];
export const rootMonitoringTools = new Set(rootMonitoringToolDefinitions.map(tool => tool.name));
export const rootMonitoringResources = [{ uri: 'msp://root/monitoring', name: 'Operator monitoring', description: 'Private open alerts and observed availability.', tool: 'get_root_monitoring' },
  { uri: 'msp://root/api-usage', name: 'Platform API usage', description: 'Private latest provider-reported API usage readings.', tool: 'get_root_api_usage' }];
export async function executeRootMonitoringTool(actorId: string, name: string, args: Record<string, unknown>, cap?: number) {
  if (name === 'get_root_api_usage') {
    if (Object.keys(args).some(key => key !== 'providerId' && key !== 'locale')) throw new OperationError('invalid_request', 'Only providerId and locale are accepted.');
    return readRootApiUsage(actorId, { providerId: args.providerId, locale: args.locale === 'fr' ? 'fr' : 'en', ...(cap ? { resultCap: cap } : {}) });
  }
  if (name === 'get_root_monitoring') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
    return readRootOperatorMonitoring(actorId, cap);
  }
  if (name === 'test_root_monitoring') {
    if (Object.keys(args).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Enter the exact confirmation.');
    return testRootOperatorMonitoring(actorId, args.confirmation);
  }
  if (name === 'evaluate_root_monitoring') {
    if (Object.keys(args).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Enter the exact confirmation.');
    return runRootOperatorMonitoring(actorId, args.confirmation);
  }
  throw new OperationError('not_found', 'Unknown tool.');
}
