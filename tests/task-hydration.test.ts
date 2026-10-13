// @vitest-environment jsdom
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { TasksClient } from '../src/components/TasksClient';
it('adopts text entered before hydration so creating a task remains reachable', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const content = createElement(TasksClient, { tasks: [], members: [], myId: 'user', canEdit: true });
  const container = document.createElement('div');
  document.body.append(container); container.innerHTML = renderToString(content);
  const input = container.querySelector<HTMLInputElement>('#task-title')!;
  input.value = 'Typed before hydration';
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, content); });
  expect(input.value).toBe('Typed before hydration');
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  await act(async () => root.unmount()); container.remove();
});
