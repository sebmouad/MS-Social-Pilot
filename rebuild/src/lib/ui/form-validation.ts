export type FieldMessages = { empty: string; invalid?: string; tooShort?: string };

export function validateFields(form: HTMLFormElement, messages: Record<string, FieldMessages>) {
  const errors: Record<string, string> = {};
  for (const [name, copy] of Object.entries(messages)) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    const value = field.value.trim();
    if (!value) errors[name] = copy.empty;
    else if (field.validity.typeMismatch || field.validity.patternMismatch) errors[name] = copy.invalid ?? copy.empty;
    else if (field.validity.tooShort || (field.minLength > 0 && value.length < field.minLength)) errors[name] = copy.tooShort ?? copy.invalid ?? copy.empty;
  }
  const first = Object.keys(errors)[0];
  if (first) {
    const field = form.elements.namedItem(first);
    if (field instanceof HTMLElement) field.focus();
  }
  return errors;
}
