"use client";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

type InlineEditProps = {
  value: string;
  /** Resolve to null on success or a safe message to keep the editor open for correction. */
  onSave: (next: string) => Promise<string | null> | string | null;
  /** Names the field for assistive technology: "Edit {label}". */
  label: string;
  editLabel?: string;
  saveLabel?: string;
  cancelLabel?: string;
  failureLabel?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
};

/**
 * Edit a single value where it is shown. Enter saves, Escape cancels, focus returns to the edit button.
 * A failed save keeps the typed text and shows the message beside the field.
 */
export function InlineEdit({ value, onSave, label, editLabel = "Edit", saveLabel = "Save", cancelLabel = "Cancel", failureLabel = "Could not save. Try again.", placeholder, maxLength, disabled }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const wasEditing = useRef(false);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } else if (wasEditing.current) editRef.current?.focus(); wasEditing.current = editing; }, [editing]);

  const cancel = () => { setEditing(false); setError(""); setDraft(value); };
  const save = async () => {
    if (busy) return;
    if (draft === value) { cancel(); return; }
    setBusy(true); setError("");
    try {
      const failure = await onSave(draft);
      if (failure) setError(failure); else setEditing(false);
    } catch { setError(failureLabel); } finally { setBusy(false); }
  };

  if (!editing) {
    return <span className="ui-inline-edit">
      <span className="ui-inline-edit__value">{value || <span className="ui-inline-edit__placeholder">{placeholder}</span>}</span>
      <button ref={editRef} type="button" className="ui-icon-button" disabled={disabled} aria-label={`${editLabel} ${label}`} onClick={() => { setDraft(value); setEditing(true); }}><IconPencil size={16} stroke={1.75} aria-hidden="true" /></button>
    </span>;
  }
  return <span className="ui-inline-edit is-editing">
    <input ref={inputRef} className="ui-input ui-inline-edit__input" value={draft} maxLength={maxLength} disabled={busy} aria-label={label} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } }} />
    <button type="button" className="ui-icon-button is-confirm" aria-label={saveLabel} aria-busy={busy || undefined} disabled={busy} onClick={() => void save()}><IconCheck size={16} stroke={2} aria-hidden="true" /></button>
    <button type="button" className="ui-icon-button" aria-label={cancelLabel} disabled={busy} onClick={cancel}><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
    {error && <span id={errorId} role="alert" className="ui-field-error">{error}</span>}
  </span>;
}
