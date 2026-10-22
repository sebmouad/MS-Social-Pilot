import { headers } from 'next/headers';
import { requireViewer } from '@/server/context';
import { writingAgents } from '../server/service';
import { agentCopy } from '../server/copy';
import { AgentsScreen, type AgentResult } from './AgentsScreen';
export default async function AgentsPage() {
 const viewer = await requireViewer({ module: 'agents', feature: 'agents/library', channelScoped: true });
 const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
 const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
 const [listing, history, copy] = await Promise.all([writingAgents(actor, { action: 'list' }), writingAgents(actor, { action: 'history' }), agentCopy(locale)]);
 async function execute(input: unknown): Promise<AgentResult> {
  'use server';
  const current = await requireViewer({ module: 'agents', feature: 'agents/library', channelScoped: true });
  try { return await writingAgents({ userId: current.user.id, workspaceId: current.workspaceId }, input, { locale }); }
  catch (error) { const { OperationError } = await import('@/lib/operation-error'); return { error: error instanceof OperationError ? error.message : copy.failed }; }
 }
 return <AgentsScreen agents={'agents' in listing ? listing.agents ?? [] : []} runs={'runs' in history ? history.runs ?? [] : []} hasMore={'hasMore' in history && history.hasMore === true} pageSize={'pageSize' in history ? history.pageSize ?? 1 : 1} copy={copy} locale={locale} execute={execute} />;
}
