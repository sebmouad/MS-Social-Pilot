import { headers } from 'next/headers';
import { requireViewer } from '@/server/context';
import { writingAgents } from '../server/service';
import { scheduledAgents } from '../server/scheduled';
import { agentCopy } from '../server/copy';
import { AgentsScreen, type AgentResult } from './AgentsScreen';
import { ScheduledAgents, type ScheduledResult } from './ScheduledAgents';
import { toolsCopy } from '../../content-tools/server/copy-loader';
import { StudioLinks } from '../../ui/StudioLinks';
export default async function AgentsPage() {
 const viewer = await requireViewer({ module: 'studio', feature: 'studio/agents', channelScoped: true });
 const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
 const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
 const [listing, history, scheduled, copy, links] = await Promise.all([writingAgents(actor, { action: 'list' }), writingAgents(actor, { action: 'history' }), scheduledAgents(actor, { action: 'list' }), agentCopy(locale), toolsCopy(locale)]);
 async function execute(input: unknown): Promise<AgentResult> {
  'use server';
  const current = await requireViewer({ module: 'studio', feature: 'studio/agents', channelScoped: true });
  try { return await writingAgents({ userId: current.user.id, workspaceId: current.workspaceId }, input, { locale }); }
  catch (error) { const { OperationError } = await import('@/lib/operation-error'); return { error: error instanceof OperationError ? error.message : copy.failed }; }
 }
 async function executeScheduled(input: unknown): Promise<ScheduledResult> {
  'use server';
  const current = await requireViewer({ module: 'studio', feature: 'studio/agents', channelScoped: true });
  try { return await scheduledAgents({ userId: current.user.id, workspaceId: current.workspaceId }, input, { locale }); }
  catch (error) { const { OperationError } = await import('@/lib/operation-error'); return { error: error instanceof OperationError ? error.message : copy.failed }; }
 }
 const scheduledList = 'agents' in scheduled ? scheduled : { agents: [], channels: [], maxDrafts: 5, briefMax: 2000, history: [] };
 return <>
  <AgentsScreen agents={'agents' in listing ? listing.agents ?? [] : []} runs={'runs' in history ? history.runs ?? [] : []} hasMore={'hasMore' in history && history.hasMore === true} pageSize={'pageSize' in history ? history.pageSize ?? 1 : 1} copy={copy} locale={locale} execute={execute} />
  <ScheduledAgents agents={scheduledList.agents ?? []} channels={scheduledList.channels ?? []} maxDrafts={scheduledList.maxDrafts ?? 5} briefMax={scheduledList.briefMax ?? 2000} history={'history' in scheduledList && scheduledList.history ? scheduledList.history : []} policy={'policy' in scheduledList ? scheduledList.policy ?? null : null} canManageTier={viewer.membership.role === 'owner' || viewer.membership.role === 'admin'} copy={copy} locale={locale} execute={executeScheduled} />
  <StudioLinks copy={links} />
 </>;
}
