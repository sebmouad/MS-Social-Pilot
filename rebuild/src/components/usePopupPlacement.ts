"use client";
import { useLayoutEffect, type RefObject } from "react";

export type PopupPlacement = { flip: boolean; shiftX: number; maxHeight: number };

/**
 * Pure placement rule. `anchor` and `popup` are viewport rectangles measured at the
 * popup's default position (below the anchor, aligned by CSS). Flips above when the
 * popup does not fit below and there is more room above; shifts horizontally to stay
 * inside the viewport; `maxHeight` is the room left on the chosen side.
 */
export function computePopupPlacement(anchor: { top: number; bottom: number }, popup: { left: number; right: number; height: number }, viewport: { width: number; height: number }, gap = 8): PopupPlacement {
  const below = viewport.height - anchor.bottom - gap;
  const above = anchor.top - gap;
  const flip = popup.height > below && above > below;
  let shiftX = 0;
  if (popup.right > viewport.width - gap) shiftX = viewport.width - gap - popup.right;
  if (popup.left + shiftX < gap) shiftX = gap - popup.left;
  return { flip, shiftX, maxHeight: Math.max(120, flip ? above : below) };
}

/** Measures an open popup and writes `data-flip`, `--ui-shift-x` and `--ui-max-h` so it stays inside the viewport. */
export function usePopupPlacement(open: boolean, anchorRef: RefObject<HTMLElement | null>, popupRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current, popup = popupRef.current;
      if (!anchor || !popup) return;
      popup.removeAttribute("data-flip");
      popup.style.removeProperty("--ui-shift-x");
      popup.style.removeProperty("--ui-max-h");
      const a = anchor.getBoundingClientRect(), p = popup.getBoundingClientRect();
      const result = computePopupPlacement(a, p, { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight });
      if (result.flip) popup.setAttribute("data-flip", "top");
      if (result.shiftX) popup.style.setProperty("--ui-shift-x", `${Math.round(result.shiftX)}px`);
      popup.style.setProperty("--ui-max-h", `${Math.floor(result.maxHeight)}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, anchorRef, popupRef]);
}
