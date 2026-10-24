import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { requestLocale } from '@/server/platforms/request-locale';
import { OperationError } from '@/lib/operation-error';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { requireViewer } from '@/server/context';
import { captionCopy, learnCaptionTest, listCaptionTests, listTestablePosts, startCaptionTestInput, type Locale } from '../server/service';
import type { InstantFormatter } from '@/server/instant-labels';
import { CaptionTestsScreen, type CaptionAction, type CaptionActionResult } from './CaptionTestsScreen';
import { toolsCopy } from '../../content-tools/server/copy-loader';
import { StudioLinks } from '../../ui/StudioLinks';

export default async function CaptionTestsPage() {
  const viewer = await requireViewer({ module: 'studio', feature: 'studio/tests', channelScoped: true });
  const locale: Locale = await requestLocale();
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const instants = await workspaceInstantFormatter(viewer.workspaceId, locale);
  const [data, copy, links] = await Promise.all([listCaptionTests(actor, { locale }), captionCopy(locale), toolsCopy(locale)]);
  const channels = data.canStart ? (await publishingDestinationChoices(viewer)).filter(channel => channel.canPublish).map(channel => ({ id: channel.id, name: channel.name })) : [];
  const testable = data.canStart ? await listTestablePosts(actor, { locale }).catch(() => []) : [];

  /** One injected action boundary: the screen never reaches storage, only the shared service. It captures only serializable values (locale, copy). */
  async function execute(action: CaptionAction): Promise<CaptionActionResult> {
    'use server';
    const current = await requireViewer({ module: 'studio', feature: 'studio/tests', channelScoped: true });
    const who = { userId: current.user.id, workspaceId: current.workspaceId };
    const formatter = await workspaceInstantFormatter(current.workspaceId, locale);
    try {
      if (action.type === 'start') await startCaptionTestInput(who, action.input, { locale });
      else await learnCaptionTest(who, { id: action.id, confirmation: action.confirmation }, { locale });
      // Refresh failures after an acknowledged write never invite a second write.
      return await Promise.all([listCaptionTests(who, { locale }), listTestablePosts(who, { locale }).catch(() => [])]).then(([fresh, posts]) => ({ ok: true as const, tests: label(fresh.tests, formatter), posts }), () => ({ ok: true as const }));
    } catch (error) { return { error: error instanceof OperationError ? error.message : copy.errUpstream }; }
  }

  return <>
    <CaptionTestsScreen tests={label(data.tests, instants)} channels={channels} posts={testable} canLearn={data.canLearn} canStart={data.canStart} limits={data.limits} copy={copy} locale={locale} execute={execute} />
    <StudioLinks copy={links} />
  </>;
}

function label<T extends { createdAt: string; dueAt: string | null }>(tests: T[], instants: InstantFormatter) {
  return tests.map(test => labelInstants(test, { createdAt: 'date', dueAt: 'date' }, instants));
}
