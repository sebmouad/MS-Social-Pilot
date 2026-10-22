import type { ReactNode } from 'react';
import { InfoTip, LinkTabs, PageHeader } from '@/components';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import type { requireViewer } from '@/server/context';
import { loadContent } from '../../server/content-copy';
import { shellChrome } from '@/modules/shell/server/chrome';

export type LibrarySection = 'media' | 'templates' | 'labels' | 'fields';

/** Library sections, their routes and the feature that gates each (a section the viewer cannot use is not offered). Feeds left for its own Content tab in the 2026-10-22 UX organization. */
const SECTIONS: ReadonlyArray<{ id: LibrarySection; href: string; feature: string }> = [
  { id: 'media', href: '/content/library', feature: 'publishing/media' },
  { id: 'templates', href: '/content/library/templates', feature: 'publishing/templates' },
  { id: 'labels', href: '/content/library/labels', feature: 'publishing/labels' },
  { id: 'fields', href: '/content/library/fields', feature: 'publishing/collaboration' },
];

/**
 * Header of every Library screen (design v2 S6): the title, an ⓘ for what the section does, the section tabs
 * (Media · Templates · Labels · Fields) and the section's own actions.
 */
export async function LibraryHeader({ active, viewer, actions, count, title }: { active: LibrarySection; viewer: Awaited<ReturnType<typeof requireViewer>>; actions?: ReactNode; count?: ReactNode; title?: string }) {
  const [{ copy }, { copy: shell }] = await Promise.all([loadContent(), shellChrome()]);
  const label: Record<LibrarySection, string> = { media: copy.libraryMedia, templates: copy.libraryTemplates, labels: copy.libraryLabels, fields: copy.libraryFields };
  const info: Record<LibrarySection, string> = { media: copy.libraryInfoMedia, templates: copy.libraryInfoTemplates, labels: copy.libraryInfoLabels, fields: copy.libraryInfoFields };
  const items = SECTIONS.filter(section => section.id === active || (canUseFeature(viewer.entitlements, section.feature) && canAccessFeature(viewer.permissions, section.feature, 'read')))
    .map(section => ({ id: section.id, href: section.href, label: label[section.id] }));
  return <PageHeader module="publishing" title={title ?? copy.libraryTitle} count={count} info={<InfoTip name={label[active]}>{info[active]}</InfoTip>} actions={actions}
    tabs={<LinkTabs items={items} activeId={active} label={copy.libraryNav} moreLabel={shell.moreTabs} />} />;
}
