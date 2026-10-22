'use server';
import { requireRootPage } from '@/server/config/access';
import { checkSystemAlerts, testSystemAlert } from '@/modules/notifications/chat-channels/server/alerts';

export async function runAlertAction(action: 'test' | 'check', confirmation: string) {
  const actor = await requireRootPage();
  try {
    if (action !== 'test' && action !== 'check') return { ok: false as const };
    return { ok: true as const, value: await (action === 'test' ? testSystemAlert(actor.id, confirmation) : checkSystemAlerts(actor.id, confirmation)) };
  } catch { return { ok: false as const }; }
}
