import { PLATFORM_MODULES } from '@/platforms';
import { PLATFORM_HOSTS } from '@/server/platforms';
import { prisma } from '@/server/data';
import type { PlatformHost, PlatformWebhookDeliveriesCopy, PlatformWebhookDelivery } from '@/server/platforms/host';
import { assertRootActor } from '@/modules/root/server/admin/authz';
import { OperationError } from '@/lib/operation-error';

/** Fixed diagnostics bound: the panel shows recent receipts, not exportable history. */
const RECENT_DELIVERIES_LIMIT = 50;

export type RootWebhookDeliveriesView =
  | { providerId: string; name: string; supported: false }
  | { providerId: string; name: string; supported: true; copy: PlatformWebhookDeliveriesCopy; deliveries: PlatformWebhookDelivery[] | null };

/** Private, read-only: recent inbound-webhook receipts for one installed platform. Installation owner only. */
export async function readRootWebhookDeliveries(actorId: string, input: { providerId: unknown; locale?: 'en' | 'fr' }): Promise<RootWebhookDeliveriesView> {
  await assertRootActor(prisma, actorId);
  const module = PLATFORM_MODULES.find(candidate => candidate.id === input.providerId);
  if (!module) throw new OperationError('invalid_request', 'Choose an installed platform.');
  const host = (PLATFORM_HOSTS as Record<string, PlatformHost>)[module.id];
  if (!host?.webhooks) return { providerId: module.id, name: module.name, supported: false };
  const locale = input.locale ?? 'en';
  const copy = await host.webhooks.copy(locale);
  try {
    return { providerId: module.id, name: module.name, supported: true, copy, deliveries: await host.webhooks.readDeliveries(RECENT_DELIVERIES_LIMIT) };
  } catch {
    return { providerId: module.id, name: module.name, supported: true, copy, deliveries: null };
  }
}
