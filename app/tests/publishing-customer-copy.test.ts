import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PUBLISHING_MODULE_CONFIG } from '@/modules/publishing/config';
import { publishingCopyDefaults, publishingCopySchema, resolvePublishingCopy } from '@/modules/publishing/ui/kit/copy';
import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { ScheduleBadge } from '@/modules/publishing/ui/kit/kit';
import { labelCopyDefaults, labelCopySchema, resolveLabelCopy } from '@/modules/publishing/ui/labels/copy';
import { templateCopyDefaults, templateCopySchema, resolveTemplateCopy } from '@/modules/publishing/ui/templates/copy';
import { approvalNotice, postsNotice, publishingNoticeDefaults, publishingNoticeSchema } from '@/modules/publishing/ui/posts/notices';

describe('Publishing Root customer catalogs', () => {
  it('registers strict complete bilingual JSON catalogs with defaults', () => {
    for (const key of ['publishing.uiCopy', 'publishing.labelCopy', 'publishing.templateCopy', 'publishing.noticeCopy']) {
      const entry = PUBLISHING_MODULE_CONFIG.find(item => item.key === key)!;
      expect(entry.kind).toBe('json');
      expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
      const defaults = entry.defaultValue as Record<string, { en: string; fr: string }>;
      for (const value of Object.values(defaults)) {
        expect(value.en.trim()).not.toBe('');
        expect(value.fr.trim()).not.toBe('');
      }
    }
    const missing = structuredClone(publishingCopyDefaults) as Partial<typeof publishingCopyDefaults>;
    delete missing.postsTitle;
    expect(publishingCopySchema.safeParse(missing).success).toBe(false);
    const invalidTemplate = structuredClone(publishingCopyDefaults);
    invalidTemplate['postsSummary.variant0'].en = 'Missing required substitutions';
    expect(publishingCopySchema.safeParse(invalidTemplate).success).toBe(false);
    expect(labelCopySchema.safeParse({ ...labelCopyDefaults, unknown: { en: 'x', fr: 'x' } }).success).toBe(false);
    expect(templateCopySchema.safeParse({ ...templateCopyDefaults, name: { en: 'Name' } }).success).toBe(false);
    expect(publishingNoticeSchema.safeParse({ ...publishingNoticeDefaults, created: { en: 'Saved', fr: '' } }).success).toBe(false);
  });

  it('renders current Root overrides through the client boundary', () => {
    const catalog = structuredClone(publishingCopyDefaults);
    catalog.scheduledPlatform.fr = 'Réseau configuré';
    catalog.scheduledRemoteHint.fr = 'Envoi configuré';
    const html = renderToStaticMarkup(createElement(PublishingCopyProvider, { catalog, locale: 'fr', children: createElement(ScheduleBadge, { mode: 'remote', locale: 'fr' }) }));
    expect(html).toContain('Réseau configuré');
    expect(html).toContain('Envoi configuré');
    expect(html).not.toContain('publiée là-bas');
  });

  it('keeps plural selection and treats replacements as plain text', () => {
    const copy = resolvePublishingCopy(publishingCopyDefaults);
    expect(copy.en.postsSummary(1, 1, 2)).toBe('1 post · page 1 of 2');
    expect(copy.en.postsSummary(2, 1, 2)).toBe('2 posts · page 1 of 2');
    expect(copy.fr.queueSummary(1, 1, 2)).toBe('1 publication programmée · page 1 sur 2');
    const labels = structuredClone(labelCopyDefaults);
    labels['actionsFor.variant0'].fr = 'Choisir {v0}';
    expect(resolveLabelCopy(labels).fr.actionsFor('<img>')).toBe('Choisir <img>');
    expect(resolveLabelCopy(labels).en.removal({ posts: 1, templates: 2, contentMixRules: 0 })).toContain('1 post, clears it from 2 templates');
    labels['noun.post.many'].en = '{count} entries';
    expect(resolveLabelCopy(labels).en.removal({ posts: 2, templates: 0, contentMixRules: 0 })).toContain('2 entries');
    const templates = structuredClone(templateCopyDefaults);
    templates['deleteBody.variant0'].en = 'Remove {v0}?';
    expect(resolveTemplateCopy(templates).en.deleteBody('Launch')).toBe('Remove Launch?');
  });

  it('splits planned vs published headers and groups in English and French', () => {
    const copy = resolvePublishingCopy(publishingCopyDefaults);
    expect(copy.en.plannedPublished(2, 5)).toBe('2 planned · 5 published');
    expect(copy.fr.plannedPublished(2, 5)).toBe('2 prévues · 5 publiées');
    expect([copy.en.groupPlanned, copy.en.groupPlannedHint, copy.en.groupOutcome, copy.en.groupOutcomeHint]).toEqual(['Planned', 'Not yet sent', 'Outcome', 'Sent or resolved']);
    expect([copy.fr.groupPlanned, copy.fr.groupPlannedHint, copy.fr.groupOutcome, copy.fr.groupOutcomeHint]).toEqual(['Prévues', 'Pas encore envoyées', 'Résultats', 'Envoyées ou traitées']);
    expect(copy.en.calendarLegend).toBe('Legend');
    expect(copy.fr.calendarLegend).toBe('Légende');
    expect([copy.en.queueSentTitle, copy.en.queueReviewSent, copy.en.queueReviewFailed]).toEqual(['Sent', 'Review sent posts', 'Review failed posts']);
    expect([copy.fr.queueSentTitle, copy.fr.queueReviewSent, copy.fr.queueReviewFailed]).toEqual(['Envoyées', 'Voir les publications envoyées', 'Voir les publications en échec']);
    // Root rewrites keep the two count placeholders.
    const edited = structuredClone(publishingCopyDefaults);
    edited['plannedPublished.variant0'] = { en: '{v0} planned · {v1} published!', fr: '{v0} prévues · {v1} publiées !' };
    expect(publishingCopySchema.safeParse(edited).success).toBe(true);
    edited['plannedPublished.variant0'] = { en: 'planned and published', fr: '{v0} prévues · {v1} publiées' };
    expect(publishingCopySchema.safeParse(edited).success).toBe(false);
  });

  it('uses configured notices while retaining unknown-code handling', () => {
    const catalog = structuredClone(publishingNoticeDefaults);
    catalog.created.fr = 'Texte personnalisé';
    catalog.imported.fr = '{count} brouillons ajoutés';
    catalog['approval.approved'].fr = 'Validation personnalisée';
    expect(postsNotice('created', 'fr', catalog)).toBe('Texte personnalisé');
    expect(postsNotice('imported-3', 'fr', catalog)).toBe('3 brouillons ajoutés');
    expect(postsNotice('not-a-code', 'en', catalog)).toBe(null);
    expect(postsNotice('imported', 'en', catalog)).toBe(null);
    expect(approvalNotice('approved', 'fr', catalog)).toEqual({ text: 'Validation personnalisée', error: false });
  });
});
