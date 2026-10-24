import Link from 'next/link';
import { IconCalendarCog, IconRss } from '@tabler/icons-react';
import type { ToolsCopy } from '../content-tools/copy';

export type StudioLinksCopy = Pick<ToolsCopy, 'planTitle' | 'planRecipe' | 'planRecipeHint' | 'planQueue' | 'planQueueHint'>;

/**
 * Linked planning entries owned by other modules: the recipe/WordPress planner (Feeds) and
 * queue automation (Publishing). Screens are not duplicated; the links only point at them.
 */
export function StudioLinks({ copy: t }: { copy: StudioLinksCopy }) {
  return (
    <section className="ui-panel" aria-label={t.planTitle}>
      <h2>{t.planTitle}</h2>
      <ul>
        <li>
          <Link href="/content/feeds"><IconRss size={16} aria-hidden="true" /> {t.planRecipe}</Link>
          <p>{t.planRecipeHint}</p>
        </li>
        <li>
          <Link href="/content/queue"><IconCalendarCog size={16} aria-hidden="true" /> {t.planQueue}</Link>
          <p>{t.planQueueHint}</p>
        </li>
      </ul>
    </section>
  );
}
