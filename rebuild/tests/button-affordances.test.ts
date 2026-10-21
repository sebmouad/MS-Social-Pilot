// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/Button';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// premium-audit.json flags the primitive's literal button, but actions are
// supplied by callers through native button props. Exercise the rendered DOM.
describe('Button action affordances', () => {
  it('runs the supplied action without accidentally submitting its surrounding form', async () => {
    const action = vi.fn();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await act(async () => root.render(h('form', { onSubmit: submit },
      h(Button, { onClick: action }, 'Open review'))));

    await act(async () => container.querySelector('button')!.click());

    expect(action).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits an explicitly associated form from a button outside the form', async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await act(async () => root.render(h('div', null,
      h('form', { id: 'review-form', onSubmit: submit }),
      h(Button, { type: 'submit', form: 'review-form', name: 'intent', value: 'save' }, 'Save'))));

    const button = container.querySelector('button')!;
    await act(async () => button.click());

    expect(submit).toHaveBeenCalledTimes(1);
    expect((submit.mock.calls[0]![0].nativeEvent as SubmitEvent).submitter).toBe(button);
  });

  it.each([{ busy: true }, { disabled: true }])('blocks activation with %j', async props => {
    const action = vi.fn();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await act(async () => root.render(h('form', { onSubmit: submit },
      h(Button, { ...props, type: 'submit', onClick: action }, 'Save'))));

    await act(async () => container.querySelector('button')!.click());

    expect(action).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
