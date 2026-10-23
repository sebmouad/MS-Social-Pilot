import { describe, expect, it } from 'vitest';
import { isAutopilotQuietHour, isAutopilotQuietHourOfDay } from '../src/modules/studio/agents/quiet-hours';

describe('autopilot quiet hours (UI wave 2)', () => {
  it('wraps midnight by default (22:00–07:00)', () => {
    const window = { quietStartHour: 22, quietEndHour: 7 };
    for (const hour of [22, 23, 0, 6]) expect(isAutopilotQuietHourOfDay(window, hour), `hour ${hour}`).toBe(true);
    for (const hour of [7, 12, 21]) expect(isAutopilotQuietHourOfDay(window, hour), `hour ${hour}`).toBe(false);
  });
  it('handles same-day windows and the disabled window', () => {
    const window = { quietStartHour: 1, quietEndHour: 5 };
    expect(isAutopilotQuietHourOfDay(window, 1)).toBe(true);
    expect(isAutopilotQuietHourOfDay(window, 4)).toBe(true);
    expect(isAutopilotQuietHourOfDay(window, 5)).toBe(false);
    expect(isAutopilotQuietHourOfDay({ quietStartHour: 0, quietEndHour: 0 }, 3)).toBe(false);
  });
  it('checks workspace-local hours, not UTC', () => {
    const window = { quietStartHour: 22, quietEndHour: 7 };
    // 23:30 in Casablanca is 22:30 UTC in winter: quiet locally, and quiet in UTC too — pick an hour that differs.
    expect(isAutopilotQuietHour(window, 'Africa/Casablanca', new Date('2026-01-15T06:30:00.000Z'))).toBe(false); // 07:30 local
    expect(isAutopilotQuietHour(window, 'Africa/Casablanca', new Date('2026-01-15T05:30:00.000Z'))).toBe(true); // 06:30 local
  });
});
