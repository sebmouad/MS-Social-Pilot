"use client";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "./Popover";
import { useShellCopy } from "./ShellCopy";
import { fill } from "@/modules/shell/copy";

export type InfoBlock = { label?: string; text: ReactNode };

type InfoTipProps = {
  /** What the tip explains, for example "Reach". Builds the accessible name "About Reach". */
  name: string;
  /** Ordered blocks: what it is, period, coverage, missing data, source and freshness. Empty blocks are skipped. */
  blocks?: InfoBlock[];
  children?: ReactNode;
  /** Partial or stale result: shows a warning glyph with the same content. */
  warning?: boolean;
  /** Optional "Learn more" link. */
  learnMore?: { href: string; label: string };
  /** Overrides the shell's accessible-name template. */
  label?: string;
  hoverDelayMs?: number;
  className?: string;
};

/**
 * ⓘ next to a number or title. Click or Enter opens the explanation in a popover (a bottom sheet on phones);
 * on fine pointers hovering for a moment opens it too. A partial result shows ⚠ so it never looks complete.
 */
export function InfoTip({ name, blocks = [], children, warning = false, learnMore, label, hoverDelayMs = 300, className = "" }: InfoTipProps) {
  const copy = useShellCopy();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  const close = useCallback((restore: boolean) => { setOpen(false); if (restore) triggerRef.current?.focus(); }, []);
  const Glyph = warning ? IconAlertTriangle : IconInfoCircle;
  const visible = blocks.filter(block => block.text !== undefined && block.text !== null && block.text !== "");
  return <span className={`ui-infotip${warning ? " is-warning" : ""} ${className}`.trim()}
    onPointerEnter={event => { if (event.pointerType === "mouse" && !open) { clear(); timer.current = setTimeout(() => setOpen(true), hoverDelayMs); } }}
    onPointerLeave={event => { if (event.pointerType === "mouse") clear(); }}>
    <button ref={triggerRef} type="button" className="ui-infotip__trigger" aria-label={label ?? fill(copy.infoAbout, { name })} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { clear(); setOpen(value => !value); }}>
      <Glyph size={16} stroke={1.9} aria-hidden="true" />
    </button>
    <Popover open={open} anchorRef={triggerRef} onClose={close} sheetOnPhone className="ui-infotip__popover" role="dialog" id={id} label={label ?? fill(copy.infoAbout, { name })}>
      <div className="ui-infotip__body">
        {visible.map((block, index) => <p key={index} className="ui-infotip__block">{block.label && <strong>{block.label}</strong>}{block.text}</p>)}
        {children}
        {learnMore && <a className="ui-infotip__more" href={learnMore.href}>{learnMore.label}</a>}
        <button type="button" className="ui-infotip__close" onClick={() => close(true)}>{copy.close}</button>
      </div>
    </Popover>
  </span>;
}
