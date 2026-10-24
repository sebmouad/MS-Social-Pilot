
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { OperationError } from '@/lib/operation-error';
import type { PlatformAdapter, PublishMedia } from '@/platforms/types';
import { platformFor } from '@/server/platforms/registry';
import { parseDestinationFormats, resolveDestinationFormat } from '../destination-formats';
import { validateSelectedPublishingFormat } from '../formats';

type AuthorizedTarget = { id: string; socialAccount: { provider: string } | null };
/** Internal to an authorized publishing operation, after validateTargets and target locks.
 * A legacy fallback is supplied only for destinations already present on that post.
 * New destinations always resolve their own module default, never the legacy global value.
 */
export async function resolveAuthorizedDestinationFormats(
  targets: readonly AuthorizedTarget[], input: unknown, maxTargets: number,
  content: { media: readonly PublishMedia[]; link?: string | null; firstComment?: string | null; scheduled?: boolean },
  existing?: { formats: ReadonlyMap<string, string | null>; legacyFormat: string },
): Promise<Record<string, string>> {
  const errorText = await loadPublishingErrorText();
  const explicit = parseDestinationFormats(input, targets.map(target => target.id), maxTargets);
  const result: Record<string, string> = Object.create(null);
  const adapters = new Map<string,Promise<PlatformAdapter|null>>();
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    if (provider && !adapters.has(provider)) adapters.set(provider, platformFor(provider, 'publishing'));
    const adapter = provider ? await adapters.get(provider)! : null;
    if (!adapter?.publish) throw new PublishingOperationError('unavailable', 'aSelectedDestinationIsUnavailable', {}, errorText);
    const formatId = resolveDestinationFormat({
      explicit: explicit[target.id], stored: existing?.formats.get(target.id),
      legacy: existing?.formats.has(target.id) ? existing.legacyFormat : undefined,
      defaultId: adapter.defaultPublishingFormatId,
    });
    validateSelectedPublishingFormat(adapter.publishingFormats, formatId, content);
    result[target.id] = formatId;
  }
  return result;
}
