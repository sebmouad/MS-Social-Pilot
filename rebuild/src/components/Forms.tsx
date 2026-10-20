"use client";
import { IconCloudUpload, IconFile, IconX } from "@tabler/icons-react";
import { createContext, useContext, useId, useRef, useState, type DragEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

type FieldContextValue = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const FieldContext = createContext<FieldContextValue | null>(null);

type FieldProps = {
  label: string;
  children: ReactNode;
  help?: ReactNode;
  /** Safe, specific correction message. Shown beside the field and announced. */
  error?: ReactNode;
  required?: boolean;
  /** Text after the label such as "(optional)". */
  hint?: string;
  className?: string;
  /** Stable control id for pages whose tests, links or autofill refer to it; generated when omitted. */
  id?: string;
};

/** Label + control + help/error wiring. Controls inside (TextInput, or any element given `useFieldProps()`) pick up id, aria-describedby and aria-invalid. */
export function Field({ label, children, help, error, required = false, hint, className = "", id: fixedId }: FieldProps) {
  const generated = useId();
  const id = fixedId ?? generated;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
    <div className={`ui-fieldset-item ${className}`.trim()}>
      <label htmlFor={id} className="ui-label">{label}{required && <span className="ui-label__required" aria-hidden="true"> *</span>}{hint && <span className="ui-label__hint"> {hint}</span>}</label>
      {children}
      {help && <p id={helpId} className="ui-help">{help}</p>}
      {error && <p id={errorId} className="ui-field-error" role="alert">{error}</p>}
    </div>
  </FieldContext.Provider>;
}

/** Props for a custom control placed inside <Field>. */
export function useFieldProps() {
  const field = useContext(FieldContext);
  return field ? { id: field.id, "aria-describedby": field.describedBy, "aria-invalid": field.invalid || undefined, "aria-required": field.required || undefined } : {};
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
};

/** Text input with optional leading/trailing icon or button. Inherits Field wiring automatically. */
export function TextInput({ leading, trailing, className = "", ...props }: TextInputProps) {
  const field = useFieldProps();
  return <span className={`ui-input-wrap${leading ? " has-leading" : ""}${trailing ? " has-trailing" : ""}`}>
    {leading && <span className="ui-input-wrap__leading" aria-hidden="true">{leading}</span>}
    <input {...field} {...props} className={`ui-input ${className}`.trim()} />
    {trailing && <span className="ui-input-wrap__trailing">{trailing}</span>}
  </span>;
}

/** Group related fields under one visible legend. */
export function FieldGroup({ legend, description, children }: { legend: string; description?: string; children: ReactNode }) {
  return <fieldset className="ui-fieldgroup"><legend>{legend}</legend>{description && <p className="ui-help">{description}</p>}<div className="ui-fieldgroup__body">{children}</div></fieldset>;
}

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  name?: string;
};

/** On/off setting that applies immediately. Use a checkbox for choices that wait for a Save button. */
export function Switch({ checked, onChange, label, description, disabled, name }: SwitchProps) {
  const id = useId();
  return <div className="ui-switch">
    <button type="button" role="switch" id={id} aria-checked={checked} aria-describedby={description ? `${id}-d` : undefined} disabled={disabled} className="ui-switch__track" onClick={() => onChange(!checked)}><span className="ui-switch__thumb" /></button>
    {name && <input type="hidden" name={name} value={checked ? "on" : ""} />}
    <label htmlFor={id} className="ui-switch__text"><span>{label}</span>{description && <small id={`${id}-d`}>{description}</small>}</label>
  </div>;
}

export type ChoiceOption = { value: string; label: string; description?: string; icon?: ReactNode; disabled?: boolean };

type ChoiceProps = { options: ChoiceOption[]; value: string; onChange: (value: string) => void; legend: string; name?: string };

/** Large selectable cards for choices that need explanation (for example publish now / schedule / save draft). */
export function RadioCards({ options, value, onChange, legend, name }: ChoiceProps) {
  const group = useId();
  return <fieldset className="ui-fieldgroup"><legend className="ui-visually-hidden">{legend}</legend>
    <div className="ui-radio-cards">
      {options.map(option => <label key={option.value} className={`ui-radio-card${option.value === value ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`}>
        <input type="radio" name={name ?? group} value={option.value} checked={option.value === value} disabled={option.disabled} onChange={() => onChange(option.value)} />
        {option.icon && <span className="ui-radio-card__icon" aria-hidden="true">{option.icon}</span>}
        <span className="ui-radio-card__text"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
    </div>
  </fieldset>;
}

/** Single-row choice (2 to 5 short options). Never wraps: options share the width and the label truncates. Arrow keys move. */
export function SegmentedControl({ options, value, onChange, legend }: ChoiceProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (event: KeyboardEvent) => {
    const enabled = options.map((option, index) => ({ option, index })).filter(entry => !entry.option.disabled);
    const at = enabled.findIndex(entry => entry.option.value === value);
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta || !enabled.length) return;
    event.preventDefault();
    const next = enabled[(at + delta + enabled.length) % enabled.length]!;
    onChange(next.option.value);
    refs.current[next.index]?.focus();
  };
  return <div role="radiogroup" aria-label={legend} className="ui-segmented" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} onKeyDown={onKey}>
    {options.map((option, index) => <button key={option.value} ref={node => { refs.current[index] = node; }} type="button" role="radio" aria-checked={option.value === value} tabIndex={option.value === value ? 0 : -1} disabled={option.disabled}
      className="ui-segmented__option" title={option.label} onClick={() => onChange(option.value)}>
      {option.icon && <span aria-hidden="true" className="ui-segmented__icon">{option.icon}</span>}<span className="ui-segmented__label">{option.label}</span>
    </button>)}
  </div>;
}

type FileDropzoneProps = {
  onFiles: (files: File[]) => void;
  /** Visible instruction, for example "Drop images here or browse". */
  label: string;
  /** Limits shown to the person, for example "PNG or JPG, up to 5 MB". */
  help?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Files already chosen; each gets a remove button. */
  files?: Array<{ id: string; name: string }>;
  onRemove?: (id: string) => void;
  removeLabel?: string;
};

/** Drag-and-drop target that is also a keyboard-operable file button. Validation of type and size stays with the caller's service. */
export function FileDropzone({ onFiles, label, help, accept, multiple = false, disabled, busy, files, onRemove, removeLabel = "Remove" }: FileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const take = (list: FileList | null) => { if (list?.length) onFiles(Array.from(list)); };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setOver(false); if (!disabled && !busy) take(event.dataTransfer.files); };
  return <div className="ui-dropzone-wrap">
    <div className={`ui-dropzone${over ? " is-over" : ""}${disabled ? " is-disabled" : ""}`} onDragOver={event => { event.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <IconCloudUpload size={28} stroke={1.5} aria-hidden="true" />
      <button type="button" className="ui-dropzone__button" id={id} disabled={disabled || busy} aria-busy={busy || undefined} aria-describedby={help ? `${id}-h` : undefined} onClick={() => input.current?.click()}>{label}</button>
      {help && <small id={`${id}-h`}>{help}</small>}
      <input ref={input} type="file" tabIndex={-1} className="ui-visually-hidden" accept={accept} multiple={multiple} disabled={disabled} onChange={event => { take(event.target.files); event.target.value = ""; }} />
    </div>
    {files && files.length > 0 && <ul className="ui-dropzone__files">{files.map(file => <li key={file.id}><IconFile size={16} aria-hidden="true" /><span>{file.name}</span>
      {onRemove && <button type="button" className="ui-icon-button" aria-label={`${removeLabel} ${file.name}`} onClick={() => onRemove(file.id)}><IconX size={14} aria-hidden="true" /></button>}</li>)}</ul>}
  </div>;
}
