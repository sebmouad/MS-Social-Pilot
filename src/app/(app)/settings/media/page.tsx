import { getTranslations } from 'next-intl/server';

import { MediaLibrary } from '@/components/MediaLibrary';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canDeleteMedia } from '@/lib/constants';
import { readMediaLibrary } from '@/lib/media';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('media.title');
}


/**
 * What this workspace is holding, and what can be thrown away.
 *
 * Uploads were reachable and deletable through the API from the start, with
 * nothing on screen for either. That mattered more than a missing screen
 * usually does: the upload quota, when it fills, refuses the upload and tells
 * the person to delete some files — an instruction the app gave them no way to
 * follow.
 */
export default async function MediaPage() {
  const auth = await requirePage();
  const t = await getTranslations('media');
  const library = await readMediaLibrary(auth.workspace.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <MediaLibrary
        canDelete={canDeleteMedia(auth.role)}
        usage={library.usage}
        truncated={library.truncated}
        files={library.files.map((file) => ({
          id: file.id,
          filename: file.filename,
          kind: file.kind,
          size: file.size,
          url: file.url,
          uploadedLabel: formatInZone(file.createdAt, auth.workspace.timezone),
          heldBy: file.heldBy.map((post) => ({
            id: post.id,
            // Enough to recognise the post by, without turning the row into a
            // wall of text.
            excerpt: post.message.trim().slice(0, 80) || t('untitledPost'),
          })),
        }))}
      />
    </div>
  );
}
