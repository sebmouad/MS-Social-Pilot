import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { headers } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { requireViewer } from '@/server/context';
import { captionCopy, learnCaptionTest, listCaptionTests, listTestablePosts, startCaptionTestInput, type Locale } from '../server/service';
import { CaptionTestsScreen, type CaptionAction, type CaptionActionResult } from './CaptionTestsScreen';

export default async function CaptionTestsPage() {
  const viewer = await requireViewer({ module: 'analytics', feature: 'analytics/posts', channelScoped: true });
  const locale: Locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const instants = await workspaceInstantFormatter(viewer.workspaceId, locale);
  const label = <T extends { createdAt: string; dueAt: string | null }>(tests: T[]) => tests.map(test => labelInstants(test, { createdAt: 'date', dueAt: 'date' }, instants));
  const [data, copy] = await Promise.all([listCaptionTests(actor, { locale }), captionCopy(locale)]);
  const channels = data.canStart ? (await publishingDestinationChoices(viewer)).filter(channel => channel.canPublish).map(channel => ({ id: channel.id, name: channel.name })) : [];
  const testable = data.canStart ? await listTestablePosts(actor, { locale }).catch(() => []) : [];

  /** One injected action boundary: the screen never reaches storage, only the shared service. */
  async function execute(action: CaptionAction): Promise<CaptionActionResult> {
    'use server';
    const current = await requireViewer({ module: 'analytics', feature: 'analytics/posts', channelScoped: true });
    const who = { userId: current.user.id, workspaceId: current.workspaceId };
    try {
      if (action.type === 'start') await startCaptionTestInput(who, action.input, { locale });
      else await learnCaptionTest(who, { id: action.id, confirmation: action.confirmation }, { locale });
      // Refresh failures after an acknowledged write never invite a second write.
      return await Promise.all([listCaptionTests(who, { locale }), listTestablePosts(who, { locale }).catch(() => [])]).then(([fresh, posts]) => ({ ok: true as const, tests: label(fresh.tests), posts }), () => ({ ok: true as const }));
    } catch (error) { return { error: error instanceof OperationError ? error.message : copy.errUpstream }; }
  }

  return <CaptionTestsScreen tests={label(data.tests)} channels={channels} posts={testable} canLearn={data.canLearn} canStart={data.canStart} limits={data.limits} copy={copy} locale={locale} execute={execute} />;
}
