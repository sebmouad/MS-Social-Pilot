// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduledAgents } from '@/modules/studio/agents/ui/ScheduledAgents';
import type { ResolvedAutopilotPolicy } from '@/modules/studio/agents/server/autopilot';
import { AGENT_COPY } from '@/modules/studio/agents/copy';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const execute = vi.fn();
const policy: ResolvedAutopilotPolicy = { tier: 'assisted', maxSendsPerDay: 10, quietStartHour: 22, quietEndHour: 7, targetIds: null, draftsOnlyTargetIds: [], newTargetGraceDays: 14 };
const channels = [{ id: 'target-a', name: 'Page A' }];
const history = [{ agentId: 'agent-a', at: '2026-10-22T08:00:00.000Z', drafts: 2, code: null, tier: 'supervised_auto', scheduled: 2 }];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  execute.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(locale: 'en' | 'fr' = 'en', canManageTier = true) {
  await act(async () => root.render(createElement(ScheduledAgents, { agents: [], channels, maxDrafts: 5, briefMax: 2000, history, policy: { ...policy }, canManageTier, copy: AGENT_COPY[locale], locale, execute })));
}
it('shows the current tier and the provenance of automatic sends in history', async () => {
  await render();
  expect(container.textContent).toContain('Autopilot tier');
  expect(container.textContent).toContain('Assisted');
  expect(container.textContent).toContain('Automatic sends: 2');
  expect(container.textContent).toContain('Supervised auto');
});
it('hides the tier form from members who cannot manage it', async () => {
  await render('en', false);
  expect(container.textContent).toContain('Autopilot tier');
  expect(container.querySelector('input[name=tier]')).toBeNull();
  expect(container.textContent).not.toContain('Change autopilot tier');
});
it('changes the tier only through the exact typed confirmation', async () => {
  execute.mockImplementation(async (input: { action: string }) => input.action === 'tier'
    ? { ok: true, policy: { ...policy, tier: 'supervised_auto' } }
    : { agents: [], history });
  await render();
  await act(async () => {
    const radio = container.querySelector<HTMLInputElement>('input[name=tier][value=supervised_auto]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(radio, true);
    radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { [...container.querySelectorAll('button')].find(el => el.textContent === 'Change autopilot tier')!.click(); });
  await act(async () => {});
  await act(async () => {});
  expect(container.querySelector('dialog')).not.toBeNull();
  const field = container.querySelector<HTMLInputElement>('dialog input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'SET AUTOPILOT TIER supervised_auto');
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(el => el.textContent === 'Confirm action')!.click(); });
  await act(async () => {});
  expect(execute).toHaveBeenCalledWith({ action: 'tier', tier: 'supervised_auto', guardrails: expect.objectContaining({ maxSendsPerDay: 10, quietStartHour: 22, quietEndHour: 7 }), confirmation: 'SET AUTOPILOT TIER supervised_auto' });
  expect(container.textContent).toContain('Autopilot tier saved.');
});
