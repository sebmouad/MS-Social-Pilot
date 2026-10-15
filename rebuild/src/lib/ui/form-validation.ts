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
