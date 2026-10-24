import { OperationError } from '@/lib/operation-error';
import type { Actor } from '../server/access';
import { readGoals, setGoals } from './server/goals';

const goal = { type: ['integer', 'null'], minimum: 1, maximum: 100000000 };
export const analyticsGoalToolDefinitions = [
  { name: 'get_analytics_goals', description: 'Read monthly goals and progress this month (workspace time zone) for channels you can access, with the metrics each channel can track. Unknown progress is reported as no data, never zero.', inputSchema: { type: 'object', properties: { channelId: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_analytics_goals', description: 'Set or clear (null) monthly goals for one channel: followers (new followers), views, engagements, posts. Only metrics listed as trackable for the channel can be set. Owners, admins and editors only. Confirmation: SET ANALYTICS GOALS <channelId>.', inputSchema: { type: 'object', required: ['channelId', 'goals', 'confirmation'], properties: { channelId: { type: 'string' }, goals: { type: 'object', properties: { followers: goal, views: goal, engagements: goal, posts: goal }, additionalProperties: false }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export async function executeAnalyticsGoalTool(actor: Actor, name: string, args: Record<string, unknown>) {
  if (name === 'get_analytics_goals') return readGoals(actor, args);
  if (name === 'set_analytics_goals') return setGoals(actor, args);
  throw new OperationError('invalid_request', 'Unknown Analytics goals action.');
}
