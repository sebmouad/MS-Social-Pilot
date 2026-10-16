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
export function collectFormErrors(form: HTMLFormElement, customErrors: Record<string, string> = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    if (!element.name || !element.willValidate) continue;
    const value = element.value;
    if (!element.validity.valid) errors[element.name] ??= constraintMessage(element);
    // Browsers do not consistently enforce length after a programmatic value change.
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && value) {
      if (element.minLength > 0 && value.length < element.minLength) errors[element.name] ??= `Use at least ${element.minLength} characters.`;
      if (element.maxLength >= 0 && value.length > element.maxLength) errors[element.name] ??= `Use no more than ${element.maxLength} characters.`;
    }
  }
  for (const [name, message] of Object.entries(customErrors)) if (message) errors[name] = message;
  return errors;
}

/** Current product locale is English; browser-owned validation strings can use another locale. */
function constraintMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const validity = field.validity;
  if (validity.valueMissing) return field instanceof HTMLSelectElement ? 'Choose an option.' : field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type) ? 'Select an option to continue.' : 'Enter a value.';
  if (validity.typeMismatch) return field instanceof HTMLInputElement && field.type === 'email' ? 'Enter a valid email address.' : 'Enter a complete URL.';
  if (validity.badInput) return 'Enter a valid value.';
  if (validity.rangeUnderflow && field instanceof HTMLInputElement) return `Enter a value of at least ${field.min}.`;
  if (validity.rangeOverflow && field instanceof HTMLInputElement) return `Enter a value no greater than ${field.max}.`;
  if (validity.stepMismatch) return 'Enter a value using the allowed increment.';
  if (validity.patternMismatch) return 'Use the requested format.';
  if (validity.tooShort && !(field instanceof HTMLSelectElement)) return `Use at least ${field.minLength} characters.`;
  if (validity.tooLong && !(field instanceof HTMLSelectElement)) return `Use no more than ${field.maxLength} characters.`;
  return 'Check this value.';
}
