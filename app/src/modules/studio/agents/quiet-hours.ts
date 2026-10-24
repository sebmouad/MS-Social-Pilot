import { instantToWall } from '@/lib/calendar-dates';

/** Workspace quiet window from the resolved autopilot policy. Equal start/end disables the window. */
export type AutopilotQuietWindow = { quietStartHour: number; quietEndHour: number };

/** True when the instant falls in the workspace-local quiet window (wraps midnight). Pure and client-safe. */
export function isAutopilotQuietHour(window: AutopilotQuietWindow, timeZone: string, at: Date): boolean {
  const hour = Number(instantToWall(at, timeZone).time.slice(0, 2));
  return isAutopilotQuietHourOfDay(window, hour);
}

/** True when the workspace-local hour (0–23) falls in the quiet window. Pure and client-safe. */
export function isAutopilotQuietHourOfDay(window: AutopilotQuietWindow, hour: number): boolean {
  const { quietStartHour: start, quietEndHour: end } = window;
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
