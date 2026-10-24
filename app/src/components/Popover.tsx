"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

export type PopoverAlign = "start" | "end";

export type PopoverPlacement = { left: number; top: number; maxHeight: number; flipped: boolean };

/**
 * Pure placement rule for a fixed popover. Rectangles are viewport coordinates. The popover opens below the
 * anchor, flips above when it does not fit and there is more room above, is shifted to stay inside the
 * viewport, and `maxHeight` is the room left on the chosen side.
 */
export function placePopover(anchor: { left: number; right: number; top: number; bottom: number }, size: { width: number; height: number }, viewport: { width: number; height: number }, align: PopoverAlign = "start", gap = 8): PopoverPlacement {
  const below = viewport.height - anchor.bottom - gap;
  const above = anchor.top - gap;
  const flipped = size.height > below && above > below;
  const room = Math.max(120, flipped ? above : below);
  const height = Math.min(size.height, room);
  let left = align === "end" ? anchor.right - size.width : anchor.left;
  left = Math.min(left, viewport.width - gap - size.width);
  left = Math.max(left, gap);
  return { left, top: flipped ? anchor.top - gap - height : anchor.bottom + gap, maxHeight: room, flipped };
}

type PopoverProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
  align?: PopoverAlign;
  className?: string;
  role?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  /** Popup is at least as wide as its anchor. */
  matchAnchorWidth?: boolean;
  /** Close when the page behind scrolls (not when the popover itself scrolls). */
  closeOnScroll?: boolean;
  /** Below 760 px render as a bottom sheet instead of an anchored popup. */
  sheetOnPhone?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * Anchored popup with `position: fixed`, placed from the anchor rectangle, so tables and scroll areas never clip it.
 * It renders next to its anchor in the DOM (no portal): inside a modal dialog it stays in the browser top layer,
 * and focus order and React events follow the trigger. Do not put it under a transformed ancestor.
 * Escape closes and returns focus to the anchor; a pointer press outside closes without moving focus.
 */
export function Popover({ open, anchorRef, onClose, children, align = "start", className = "", role, id, label, labelledBy, matchAnchorWidth = false, closeOnScroll = false, sheetOnPhone = false, onKeyDown }: PopoverProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const [flipped, setFlipped] = useState(false);
  const [phone, setPhone] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) { setStyle(undefined); return; }
    const place = () => {
      const anchor = anchorRef.current, popup = popupRef.current;
      if (!anchor || !popup) return;
      const isPhone = sheetOnPhone && Boolean(window.matchMedia?.("(max-width: 760px)").matches);
      setPhone(isPhone);
      if (isPhone) { setStyle({ visibility: "visible" }); return; }
      const rect = anchor.getBoundingClientRect();
      const width = matchAnchorWidth ? Math.max(rect.width, popup.offsetWidth) : popup.offsetWidth;
      const result = placePopover(rect, { width, height: popup.scrollHeight || popup.offsetHeight }, { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight }, align);
      setFlipped(result.flipped);
      setStyle({ left: result.left, top: result.top, maxHeight: result.maxHeight, ...(matchAnchorWidth ? { minWidth: rect.width } : {}), visibility: "visible" });
    };
    place();
    const onScroll = (event: Event) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      if (closeOnScroll) onCloseRef.current(false); else place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); };
  }, [open, anchorRef, align, matchAnchorWidth, closeOnScroll, sheetOnPhone]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // A native dialog above the popover owns Escape.
      const top = document.querySelector("dialog[open]");
      if (top && !top.contains(popupRef.current)) return;
      event.preventDefault();
      onCloseRef.current(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, anchorRef]);

  if (!open) return null;
  return <div ref={popupRef} id={id} role={role} aria-label={label} aria-labelledby={labelledBy} className={`ui-popover${phone ? " is-sheet" : ""}${className ? ` ${className}` : ""}`} data-flip={flipped ? "top" : undefined}
    style={style ?? { visibility: "hidden", left: 0, top: 0 }} onKeyDown={onKeyDown}>
    {children}
  </div>;
}
