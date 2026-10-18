import { changePinnedMetrics, readPinnedMetrics } from './server/pins';
import { OperationError } from '@/lib/operation-error';
import type { Actor } from '../server/access';

export const analyticsPinTools = new Set<string>(['get_analytics_pins', 'pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins']);
export const analyticsPinWriteTools = new Set<string>(['pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins']);
const key = { type: 'string', minLength: 1, maxLength: 500 };
export const analyticsPinToolDefinitions = [
  { name: 'get_analytics_pins', description: 'Read your own pinned Analytics metrics with current values, coverage and freshness. A pin that is no longer available is reported as unavailable, not zero.', inputSchema: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, compare: { type: 'string', enum: ['none', 'previous', 'year'] } }, additionalProperties: false } },
  { name: 'pin_analytics_metric', description: 'Pin a single-value metric visible to you. Confirmation: PIN ANALYTICS METRIC <key>. Affects only your own preferences.', inputSchema: { type: 'object', required: ['key', 'confirmation'], properties: { key, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'unpin_analytics_metric', description: 'Remove one of your pins. Confirmation: UNPIN ANALYTICS METRIC <key>.', inputSchema: { type: 'object', required: ['key', 'confirmation'], properties: { key, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'reorder_analytics_pins', description: 'Set the order of your current pins (omitted pins are removed). Confirmation: REORDER ANALYTICS PINS <count>.', inputSchema: { type: 'object', required: ['keys', 'confirmation'], properties: { keys: { type: 'array', items: key }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export async function executeAnalyticsPinTool(actor: Actor, name: string, args: Record<string, unknown>) {
  if (name === 'get_analytics_pins') return readPinnedMetrics(actor, args);
  const action = name === 'pin_analytics_metric' ? 'pin' : name === 'unpin_analytics_metric' ? 'unpin' : name === 'reorder_analytics_pins' ? 'reorder' : null;
  if (!action) throw new OperationError('invalid_request', 'Unknown Analytics pin action.');
  return changePinnedMetrics(actor, { ...args, action });
}
