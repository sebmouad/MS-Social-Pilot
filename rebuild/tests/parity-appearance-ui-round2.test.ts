import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AppearancePicker } from '@/modules/settings/ui/appearance/picker';
import { appearanceCopy, appearanceCopySchema } from '@/modules/settings/ui/appearance/copy';
it('renders saved per-user choice and all modes with French labels', () => {
  const html = renderToStaticMarkup(createElement(AppearancePicker, { initialTheme: 'warm', initialMode: 'dark', copy: appearanceCopy.fr, canWrite: true }));
  expect(html).toContain('Chaleureux'); expect(html).toContain('Épuré');
  expect(html).toContain('value="dark" selected=""'); expect(html).toContain('Selon l’appareil'); expect(html).toContain('Enregistrer l’apparence');
  expect(html).not.toContain('Cream and coral');
});
it('renders disabled controls for readers and validates complete en/fr Root copy', () => {
  const html = renderToStaticMarkup(createElement(AppearancePicker, { initialTheme: 'clean', initialMode: 'system', copy: appearanceCopy.en, canWrite: false }));
  expect((html.match(/disabled=""/g) ?? [])).toHaveLength(6);
  expect(appearanceCopySchema.safeParse(appearanceCopy).success).toBe(true);
  expect(appearanceCopySchema.safeParse({ ...appearanceCopy, fr: { ...appearanceCopy.fr, save: '' } }).success).toBe(false);
  const { dark: _dark, ...partial } = appearanceCopy.fr;
  expect(appearanceCopySchema.safeParse({ ...appearanceCopy, fr: partial }).success).toBe(false);
});
