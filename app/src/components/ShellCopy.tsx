"use client";
import { createContext, useContext, type ReactNode } from "react";
import { SHELL_COPY, type ShellCopy } from "@/modules/shell/copy";

const ShellCopyContext = createContext<ShellCopy | null>(null);

/** The shell hands the current-locale chrome copy (Root key `home.shellCopy`) to shared popovers, filters and the scope list. */
export function ShellCopyProvider({ copy, children }: { copy: ShellCopy; children: ReactNode }) {
  return <ShellCopyContext.Provider value={copy}>{children}</ShellCopyContext.Provider>;
}

/** Copy of the surrounding shell. Outside a shell (public pages, isolated renders) the shipped English catalog applies. */
export function useShellCopy(): ShellCopy {
  return useContext(ShellCopyContext) ?? (SHELL_COPY.en as unknown as ShellCopy);
}
