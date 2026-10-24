import { z } from 'zod';

export const formValidationMessageSchema = z.object({
  choose: z.string().min(1), select: z.string().min(1), required: z.string().min(1),
  email: z.string().min(1), url: z.string().min(1), invalid: z.string().min(1),
  minimum: z.string().min(1), maximum: z.string().min(1), step: z.string().min(1),
  pattern: z.string().min(1), tooShort: z.string().min(1), tooLong: z.string().min(1),
  check: z.string().min(1),
}).strict();
export type FormValidationMessages = z.infer<typeof formValidationMessageSchema>;
export const formValidationCopySchema = z.object({ en: formValidationMessageSchema, fr: formValidationMessageSchema }).strict();
export const formValidationCopy = {
  en: {
    choose: 'Choose an option.', select: 'Select an option to continue.', required: 'Enter a value.',
    email: 'Enter a valid email address.', url: 'Enter a complete URL.', invalid: 'Enter a valid value.',
    minimum: 'Enter a value of at least {value}.', maximum: 'Enter a value no greater than {value}.',
    step: 'Enter a value using the allowed increment.', pattern: 'Use the requested format.',
    tooShort: 'Use at least {value} characters.', tooLong: 'Use no more than {value} characters.', check: 'Check this value.',
  },
  fr: {
    choose: 'Choisissez une option.', select: 'Sélectionnez une option pour continuer.', required: 'Saisissez une valeur.',
    email: 'Saisissez une adresse e-mail valide.', url: 'Saisissez une URL complète.', invalid: 'Saisissez une valeur valide.',
    minimum: 'Saisissez une valeur supérieure ou égale à {value}.', maximum: 'Saisissez une valeur inférieure ou égale à {value}.',
    step: 'Saisissez une valeur respectant le pas autorisé.', pattern: 'Utilisez le format demandé.',
    tooShort: 'Utilisez au moins {value} caractères.', tooLong: 'Utilisez au maximum {value} caractères.', check: 'Vérifiez cette valeur.',
  },
} satisfies z.infer<typeof formValidationCopySchema>;

const interpolate = (template: string, value: string | number) => template.replaceAll('{value}', String(value));

/** Explicit server-selected Root copy takes precedence; document language supports existing callers. */
function messagesFor(form: HTMLFormElement, copy?: FormValidationMessages): FormValidationMessages {
  if (copy) return copy;
  const language = form.closest('[lang]')?.getAttribute('lang') ?? form.ownerDocument.documentElement.lang;
  return formValidationCopy[language?.toLowerCase().split('-')[0] === 'fr' ? 'fr' : 'en'];
}

export type FieldMessages = { empty?: string; invalid?: string; tooShort?: string };

export function validateFields(form: HTMLFormElement, messages: Record<string, FieldMessages>) {
  const errors: Record<string, string> = {};
  for (const [name, copy] of Object.entries(messages)) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    const value = field.value.trim();
    const message = !value ? copy.empty
      : field.validity.typeMismatch || field.validity.patternMismatch ? copy.invalid ?? copy.empty
      : field.validity.tooShort || (field.minLength > 0 && value.length < field.minLength) ? copy.tooShort ?? copy.invalid ?? copy.empty
      : undefined;
    if (message) errors[name] = message;
  }
  const first = Object.keys(errors)[0];
  if (first) {
    const field = form.elements.namedItem(first);
    if (field instanceof HTMLElement) field.focus();
  }
  return errors;
}

/** Native constraints without browser bubbles; domain/server checks remain authoritative. */
export function collectFormErrors(form: HTMLFormElement, customErrors: Record<string, string> = {}, messages?: FormValidationMessages): Record<string, string> {
  const copy = messagesFor(form, messages);
  const errors: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    if (!element.name || !element.willValidate) continue;
    const value = element.value;
    if (!element.validity.valid) errors[element.name] ??= constraintMessage(element, copy);
    // Browsers do not consistently enforce length after a programmatic value change.
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && value) {
      if (element.minLength > 0 && value.length < element.minLength) errors[element.name] ??= interpolate(copy.tooShort, element.minLength);
      if (element.maxLength >= 0 && value.length > element.maxLength) errors[element.name] ??= interpolate(copy.tooLong, element.maxLength);
    }
  }
  for (const [name, message] of Object.entries(customErrors)) if (message) errors[name] = message;
  return errors;
}

/** Native validity is unchanged; only application-authored feedback is localized. */
function constraintMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, copy: FormValidationMessages): string {
  const validity = field.validity;
  if (validity.valueMissing) return field instanceof HTMLSelectElement ? copy.choose : field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type) ? copy.select : copy.required;
  if (validity.typeMismatch) return field instanceof HTMLInputElement && field.type === 'email' ? copy.email : copy.url;
  if (validity.badInput) return copy.invalid;
  if (validity.rangeUnderflow && field instanceof HTMLInputElement) return interpolate(copy.minimum, field.min);
  if (validity.rangeOverflow && field instanceof HTMLInputElement) return interpolate(copy.maximum, field.max);
  if (validity.stepMismatch) return copy.step;
  if (validity.patternMismatch) return copy.pattern;
  if (validity.tooShort && !(field instanceof HTMLSelectElement)) return interpolate(copy.tooShort, field.minLength);
  if (validity.tooLong && !(field instanceof HTMLSelectElement)) return interpolate(copy.tooLong, field.maxLength);
  return copy.check;
}
