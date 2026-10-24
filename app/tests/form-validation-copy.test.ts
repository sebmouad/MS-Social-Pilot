// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { collectFormErrors, formValidationCopy, formValidationCopySchema } from '@/lib/ui/form-validation';

afterEach(() => { document.body.innerHTML = ''; document.documentElement.lang = ''; });
function form() {
  document.body.innerHTML = '<form><select name="choice" required><option value="">—</option></select><input name="email" type="email" value="bad"><input name="short" minlength="4" value="ab"><input name="long" maxlength="3" value="four"><input name="minimum" type="number" min="2" value="1"><input name="maximum" type="number" max="5" value="6"><input name="password" type="password" minlength="3" value="   "><input name="disabled" required disabled></form>';
  return document.querySelector('form')!;
}
describe('shared bilingual validation catalog', () => {
  it('validates both complete catalogs and refuses partial catalogs', () => {
    expect(formValidationCopySchema.safeParse(formValidationCopy).success).toBe(true);
    expect(formValidationCopySchema.safeParse({ en: formValidationCopy.en, fr: {} }).success).toBe(false);
  });
  it('uses French document language including regional variants and preserves constraints', () => {
    const element = form(); document.documentElement.lang = 'fr-CA';
    expect(collectFormErrors(element)).toEqual({ choice: 'Choisissez une option.', email: 'Saisissez une adresse e-mail valide.', short: 'Utilisez au moins 4 caractères.', long: 'Utilisez au maximum 3 caractères.', minimum: 'Saisissez une valeur supérieure ou égale à 2.', maximum: 'Saisissez une valeur inférieure ou égale à 5.' });
    expect(element.querySelector<HTMLInputElement>('[name=password]')!.value).toBe('   ');
  });
  it('accepts serialized Root overrides and preserves domain-error priority', () => {
    const element = form(); element.lang = 'fr';
    const copy = { ...formValidationCopy.en, tooShort: 'Minimum: {value}; expected {value}.', email: 'Configured email guidance' };
    expect(collectFormErrors(element, {}, copy)).toMatchObject({ email: copy.email, short: 'Minimum: 4; expected 4.' });
    expect(collectFormErrors(element, { email: 'Domain feedback' }, copy).email).toBe('Domain feedback');
  });
});
