"use client";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

type ConfirmDialogProps = {
  open: boolean;
  /** The verb phrase, for example "Delete post". */
  title: string;
  /** Names the thing being changed, shown in bold so nobody confirms the wrong item. */
  objectName: string;
  /** What will happen, in plain words, including what cannot be undone. */
  consequence: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel?: string;
  /** Shown when onConfirm throws, for example "Could not delete. Nothing was changed." */
  failureLabel: string;
  /** Destructive actions use the danger button and focus Cancel first. */
  danger?: boolean;
  /** Resolve null on success; a returned message keeps the dialog open for retry. */
  onConfirm: () => Promise<string | null> | string | null;
  onClose: () => void;
};

/** Confirmation that names the object and the consequence. Cancel is focused first; failures stay inline so nothing is lost. */
export function ConfirmDialog({ open, title, objectName, consequence, confirmLabel, cancelLabel, pendingLabel, failureLabel, danger = true, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const failure = await onConfirm();
      if (failure) setError(failure); else onClose();
    } catch { setError(failureLabel); } finally { setBusy(false); }
  };
  return <Dialog open={open} title={title} closeLabel={cancelLabel} busy={busy} onClose={() => { setError(""); onClose(); }}
    actions={<><Button disabled={busy} onClick={() => { setError(""); onClose(); }}>{cancelLabel}</Button><Button variant={danger ? "danger" : "primary"} busy={busy} onClick={() => void run()}>{busy && pendingLabel ? pendingLabel : confirmLabel}</Button></>}>
    <div className="ui-confirm">
      {danger && <span className="ui-confirm__icon" aria-hidden="true"><IconAlertTriangle size={22} stroke={1.75} /></span>}
      <div><p className="ui-confirm__object"><strong>{objectName}</strong></p><p>{consequence}</p></div>
    </div>
    {error && <p role="alert" className="ui-error">{error}</p>}
  </Dialog>;
}
