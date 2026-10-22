import { headers } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { captionCopy, learnCaptionTest, learnConfirmation, listCaptionTests, listTestablePosts, startCaptionTest, START_CONFIRMATION, type Locale } from '../server/service';
import { CaptionTestsScreen, type CaptionAction, type CaptionActionResult } from './CaptionTestsScreen';

export default async function CaptionTestsPage() {
  const viewer = await requireViewer({ module: 'analytics', feature: 'analytics/posts', channelScoped: true });
  const locale: Locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [data, copy] = await Promise.all([listCaptionTests(actor, { locale }), captionCopy(locale)]);
  const testable = data.canStart ? await listTestablePosts(actor, { locale }).catch(() => []) : [];

  /** One injected action boundary: the screen never reaches storage, only the shared service. */
  async function execute(action: CaptionAction): Promise<CaptionActionResult> {
    'use server';
    const current = await requireViewer({ module: 'analytics', feature: 'analytics/posts', channelScoped: true });
    const who = { userId: current.user.id, workspaceId: current.workspaceId };
    try {
      if (action.type === 'start') await startCaptionTest(who, { ...action.input, confirmation: START_CONFIRMATION }, { locale });
      else await learnCaptionTest(who, { id: action.id, confirmation: learnConfirmation(action.id) }, { locale });
      // Refresh failures after an acknowledged write never invite a second write.
      const [fresh, posts] = await Promise.all([listCaptionTests(who, { locale }), listTestablePosts(who, { locale }).catch(() => [])]);
      return { ok: true, tests: fresh.tests, posts };
    } catch (error) { return { error: error instanceof OperationError ? error.message : copy.errUpstream }; }
  }

  return <CaptionTestsScreen tests={data.tests} posts={testable} canLearn={data.canLearn} canStart={data.canStart} limits={data.limits} copy={copy} locale={locale} execute={execute} />;
}
