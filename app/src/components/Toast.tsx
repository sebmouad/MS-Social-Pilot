"use client";
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";
export type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** One follow-up such as Undo or Retry. */
  action?: { label: string; onAction: () => void };
  /** Milliseconds before it closes itself. Errors with an action stay until dismissed. 0 keeps it open. */
  duration?: number;
};
type ToastItem = ToastInput & { id: number; tone: ToastTone };
type ToastApi = {
  notify: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  /** Success toast carrying an Undo action. */
  undoable: (title: string, undo: () => void, undoLabel: string) => number;
  /** Failure toast carrying a Retry action; stays until dismissed. */
  failed: (title: string, retry: () => void, retryLabel: string, description?: string) => number;
};

const ToastContext = createContext<ToastApi | null>(null);
const DEFAULT_DURATION = { success: 5000, info: 5000, error: 0 } as const;
const ICONS = { success: IconCircleCheck, error: IconAlertTriangle, info: IconInfoCircle } as const;

function ToastView({ toast, dismissLabel, onDismiss }: { toast: ToastItem; dismissLabel: string; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = toast.duration ?? (toast.action && toast.tone === "error" ? 0 : DEFAULT_DURATION[toast.tone]);
  useEffect(() => {
    if (!duration || paused) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, paused, onDismiss]);
  const Icon = ICONS[toast.tone];
  return <li className={`ui-toast ui-toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} aria-live={toast.tone === "error" ? "assertive" : "polite"} aria-atomic="true"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <Icon size={20} stroke={1.75} aria-hidden="true" className="ui-toast__icon" />
    <div className="ui-toast__text"><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>
    {toast.action && <button type="button" className="ui-toast__action" onClick={() => { toast.action!.onAction(); onDismiss(); }}>{toast.action.label}</button>}
    <button type="button" className="ui-toast__close" aria-label={dismissLabel} onClick={onDismiss}><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
    {duration > 0 && <span className="ui-toast__progress" style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }} aria-hidden="true" />}
  </li>;
}

/** Mount once near the app root. `maxVisible` bounds the stack; older toasts are dropped first. */
export function ToastProvider({ children, dismissLabel = "Dismiss", maxVisible = 4 }: { children: ReactNode; dismissLabel?: string; maxVisible?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setItems(list => list.filter(item => item.id !== id)), []);
  const notify = useCallback((input: ToastInput) => {
    const id = ++counter.current;
    setItems(list => [...list, { ...input, id, tone: input.tone ?? "success" }].slice(-maxVisible));
    return id;
  }, [maxVisible]);
  const api = useMemo<ToastApi>(() => ({
    notify, dismiss,
    undoable: (title, undo, undoLabel) => notify({ tone: "success", title, action: { label: undoLabel, onAction: undo }, duration: 8000 }),
    failed: (title, retry, retryLabel, description) => notify({ tone: "error", title, description, action: { label: retryLabel, onAction: retry } }),
  }), [notify, dismiss]);
  return <ToastContext.Provider value={api}>
    {children}
    <ol className="ui-toasts" aria-label="Notifications">
      {items.map(toast => <ToastView key={toast.id} toast={toast} dismissLabel={dismissLabel} onDismiss={() => dismiss(toast.id)} />)}
    </ol>
  </ToastContext.Provider>;
}

/** Returns the toast API. Outside a provider it is a no-op so shared components stay usable in isolation. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
const NOOP: ToastApi = { notify: () => 0, dismiss: () => {}, undoable: () => 0, failed: () => 0 };
