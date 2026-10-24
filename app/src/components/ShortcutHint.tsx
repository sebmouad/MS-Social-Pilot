"use client";
import { useEffect, useRef } from "react";

/** Platform-neutral key chord such as "mod+k", "shift+?" or "g p". "mod" is Cmd on Apple platforms, Ctrl elsewhere. */
function isApple() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function formatChord(chord: string, apple = isApple()) {
  return chord.split(" ").map(step => step.split("+").map(key => {
    const lower = key.toLowerCase();
    if (lower === "mod") return apple ? "⌘" : "Ctrl";
    if (lower === "shift") return apple ? "⇧" : "Shift";
    if (lower === "alt") return apple ? "⌥" : "Alt";
    if (lower === "enter") return "↵";
    if (lower === "escape" || lower === "esc") return "Esc";
    return key.length === 1 ? key.toUpperCase() : key;
  }).join(apple ? "" : "+")).join(" then ");
}

/** Visible keycap that documents a shortcut next to the action it triggers. Pair it with useShortcut. */
export function ShortcutHint({ chord, label }: { chord: string; label?: string }) {
  const text = formatChord(chord);
  return <kbd className="ui-kbd" aria-label={label ?? text} title={label}>{text}</kbd>;
}

function inEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Global shortcut. Single keys and "g p" sequences are ignored while typing in a field;
 * chords with mod/alt still fire. Pass enabled=false while a dialog owns the keyboard.
 */
export function useShortcut(chord: string, handler: (event: KeyboardEvent) => void, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const steps = chord.toLowerCase().split(" ");
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const matches = (event: KeyboardEvent, step: string) => {
      const parts = step.split("+");
      const key = parts[parts.length - 1]!;
      const wantMod = parts.includes("mod"), wantShift = parts.includes("shift"), wantAlt = parts.includes("alt");
      const mod = event.metaKey || event.ctrlKey;
      return event.key.toLowerCase() === key && mod === wantMod && event.altKey === wantAlt && (key.length > 1 || key === "?" ? true : event.shiftKey === wantShift);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const plain = !(event.metaKey || event.ctrlKey || event.altKey);
      if (plain && inEditable(event.target)) { index = 0; return; }
      if (matches(event, steps[index]!)) {
        index += 1;
        clearTimeout(timer);
        if (index === steps.length) { index = 0; event.preventDefault(); latest.current(event); return; }
        timer = setTimeout(() => { index = 0; }, 1200);
      } else index = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [chord, enabled]);
}
