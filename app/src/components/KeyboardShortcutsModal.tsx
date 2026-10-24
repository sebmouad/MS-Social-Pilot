"use client";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { ShortcutHint } from "@/components/ShortcutHint";
import { IconKeyboard } from "@tabler/icons-react";

type ShortcutRow = { chord: string; label: string };
type ShortcutSection = { category: string; rows: ShortcutRow[] };

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    category: "Global & Navigation",
    rows: [
      { chord: "mod+k", label: "Open command palette" },
      { chord: "[", label: "Toggle sidebar collapse" },
      { chord: "g h", label: "Go to Home" },
      { chord: "g c", label: "Go to Calendar" },
      { chord: "g i", label: "Go to Inbox" },
      { chord: "g a", label: "Go to Analytics" },
      { chord: "g s", label: "Go to Settings" },
      { chord: "?", label: "Open this keyboard guide" },
    ],
  },
  {
    category: "Composer & Publishing",
    rows: [
      { chord: "c", label: "Create new post / Open composer" },
      { chord: "mod+enter", label: "Schedule or publish post" },
      { chord: "mod+s", label: "Save draft" },
      { chord: "escape", label: "Dismiss modal or picker" },
    ],
  },
  {
    category: "Inbox Triage",
    rows: [
      { chord: "j", label: "Next conversation" },
      { chord: "k", label: "Previous conversation" },
      { chord: "e", label: "Mark resolved / Reopen" },
      { chord: "r", label: "Focus reply composer" },
      { chord: "x", label: "Select conversation" },
      { chord: "/", label: "Focus search" },
      { chord: "mod+enter", label: "Send reply" },
    ],
  },
];

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title="Keyboard Shortcuts"
      description="Work at the speed of thought across MS Social Pilot."
      onClose={onClose}
    >
      <div style={{ display: "grid", gap: "20px", maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
        {SHORTCUT_SECTIONS.map((sec) => (
          <div key={sec.category} style={{ display: "grid", gap: "8px" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "12px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--ink-faint)",
                borderBottom: "1px solid var(--line-subtle)",
                paddingBottom: "4px",
              }}
            >
              {sec.category}
            </h3>
            <div style={{ display: "grid", gap: "6px" }}>
              {sec.rows.map((row) => (
                <div
                  key={row.chord}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: "13px",
                    color: "var(--ink)",
                    padding: "4px 0",
                  }}
                >
                  <span>{row.label}</span>
                  <ShortcutHint chord={row.chord} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
