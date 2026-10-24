"use client";
import { useEffect, useState } from "react";

/** Colors come from the active theme's CSS custom properties; nothing is hardcoded here. */
export type ChartTheme = {
  palette: string[];
  grid: string;
  text: string;
  surface: string;
  accent: string;
  ink: string;
  inkSoft: string;
  line: string;
};
export type ChartEnv = { theme: ChartTheme; reducedMotion: boolean };

const PALETTE_SIZE = 8;

export function readChartTheme(root: HTMLElement = document.documentElement): ChartTheme {
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    palette: Array.from({ length: PALETTE_SIZE }, (_, index) => read(`--chart-${index + 1}`)).filter(Boolean),
    grid: read("--chart-grid"),
    text: read("--chart-text"),
    surface: read("--chart-surface"),
    accent: read("--chart-accent"),
    ink: read("--ink"),
    inkSoft: read("--ink-soft"),
    line: read("--line"),
  };
}

/** Palette color for series `index`; undefined lets ECharts fall back to its own default. */
export function colorAt(theme: ChartTheme, index: number): string | undefined {
  return theme.palette.length ? theme.palette[index % theme.palette.length] : undefined;
}

/** An empty custom-property value means "not defined": pass undefined, not an invalid color. */
export const css = (value: string): string | undefined => value || undefined;

/**
 * Resolved theme and motion preference. `null` until mounted (server render and the
 * first client render match); re-read on `theme-change` and on `data-theme`/`data-mode` changes.
 */
export function useChartEnv(): ChartEnv | null {
  const [env, setEnv] = useState<ChartEnv | null>(null);
  useEffect(() => {
    const motion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let frame = 0;
    const sync = () => {
      const next: ChartEnv = { theme: readChartTheme(), reducedMotion: Boolean(motion?.matches) };
      setEnv(previous => previous && previous.reducedMotion === next.reducedMotion && JSON.stringify(previous.theme) === JSON.stringify(next.theme) ? previous : next);
    };
    // Read once now and once after the next frame, in case the theme event fires before styles apply.
    const syncSoon = () => {
      sync();
      if (typeof requestAnimationFrame === "function") { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); }
    };
    sync();
    window.addEventListener("theme-change", syncSoon);
    const observer = new MutationObserver(syncSoon);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
    motion?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("theme-change", syncSoon);
      observer.disconnect();
      motion?.removeEventListener?.("change", sync);
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, []);
  return env;
}
