// @vitest-environment jsdom
import { act, createElement, createRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectFormErrors, FieldError, useFormValidation } from '../src/components/FormValidation';
import { AutoTextarea } from '../src/components/AutoTextarea';
import { Button } from '../src/components/Button';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared field validation', () => {
  it('forwards real Button actions and submit behavior through the shared primitive', async () => {
    const clicked = vi.fn(); const submitted = vi.fn();
    await act(async () => root.render(createElement('form', { onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submitted(); } },
      createElement(Button, { onClick: clicked }, 'Inspect'), createElement(Button, { type: 'submit' }, 'Save'))));
    const buttons = container.querySelectorAll('button');
    await act(async () => buttons[0].click()); expect(clicked).toHaveBeenCalledOnce(); expect(submitted).not.toHaveBeenCalled();
    await act(async () => buttons[1].click()); expect(submitted).toHaveBeenCalledOnce();
  });
  it('covers ranges, steps, email and length without trimming password values or validating disabled controls', () => {
    container.innerHTML = '<form novalidate><input name="email" type="email" value="invalid" required><input name="amount" type="number" min="1" max="10" step="0.5" value="1.1"><input name="short" minlength="4" value="ab"><input name="long" maxlength="3" value="four"><input name="password" type="password" required minlength="3" value="   "><input name="disabled" required disabled></form>';
    const form = container.querySelector('form')!;
    const errors = collectFormErrors(form);
    expect(Object.keys(errors)).toEqual(['email', 'amount', 'short', 'long']);
    expect(errors.short).toContain('4'); expect(errors.long).toContain('3');
    expect(errors.password).toBeUndefined(); expect(errors.disabled).toBeUndefined();
    expect(collectFormErrors(form, { email: 'Use your workspace email.' }).email).toBe('Use your workspace email.');
  });

  it('associates errors before focusing in document order, preserves values and recovers after correction', async () => {
    const saved = vi.fn();
    function Example() {
      const validation = useFormValidation();
      return createElement('form', { noValidate: true, onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (validation.validate(event.currentTarget)) saved(); } },
        createElement('label', null, 'Email', createElement('input', { name: 'email', type: 'email', defaultValue: 'wrong', required: true, ...validation.fieldProps('email', 'email-help') })),
        createElement('span', { id: 'email-help' }, 'Your account email'), createElement(FieldError, validation.errorProps('email')),
        createElement('label', null, 'Count', createElement('input', { name: 'count', type: 'number', min: 1, required: true, defaultValue: '0', ...validation.fieldProps('count') })),
        createElement(FieldError, validation.errorProps('count')), createElement('button', { type: 'submit' }, 'Save'));
    }
    await act(async () => root.render(createElement(Example)));
    await act(async () => container.querySelector('button')!.click());
    const email = container.querySelector<HTMLInputElement>('[name=email]')!;
    expect(document.activeElement).toBe(email); expect(email.value).toBe('wrong'); expect(email.getAttribute('aria-invalid')).toBe('true');
    const associations = email.getAttribute('aria-describedby')!.split(' ');
    expect(associations[0]).toBe('email-help'); expect(document.getElementById(associations[1])?.textContent).toBeTruthy(); expect(saved).not.toHaveBeenCalled();
    email.value = 'reader@example.test'; container.querySelector<HTMLInputElement>('[name=count]')!.value = '2';
    await act(async () => container.querySelector('button')!.click());
    expect(saved).toHaveBeenCalledOnce(); expect(email.hasAttribute('aria-invalid')).toBe(false); expect(email.getAttribute('aria-describedby')).toBe('email-help');
  });

  it('focuses the first field in the form even when domain errors have a different object order', async () => {
    function Example() {
      const validation = useFormValidation();
      return createElement('form', { noValidate: true, onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); validation.validate(event.currentTarget, { second: 'Second error', first: 'First error' }); } },
        createElement('input', { name: 'first', ...validation.fieldProps('first') }), createElement(FieldError, validation.errorProps('first')),
        createElement('input', { name: 'second', ...validation.fieldProps('second') }), createElement(FieldError, validation.errorProps('second')), createElement('button', { type: 'submit' }, 'Check'));
    }
    await act(async () => root.render(createElement(Example)));
    await act(async () => container.querySelector('button')!.click());
    expect(document.activeElement).toBe(container.querySelector('[name=first]'));
  });
});

describe('shared auto-growing textarea', () => {
  it('restores the natural height after an uncontrolled form resets', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this as HTMLTextAreaElement).value.length > 10 ? 160 : 48; });
    await act(async () => root.render(createElement('form', null, createElement(AutoTextarea, { name: 'caption', defaultValue: 'short', style: { boxSizing: 'border-box', border: 0, padding: 0 } }))));
    const field = container.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A much longer example caption'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(field.style.height).toBe('160px');
    await act(async () => container.querySelector('form')!.reset());
    expect(field.value).toBe('short'); expect(field.style.height).toBe('48px');
  });
  it('grows and shrinks for controlled content while preserving callbacks, ref and semantic input', async () => {
    const reference = createRef<HTMLTextAreaElement>(); const change = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this as HTMLTextAreaElement).value.length > 10 ? 160 : 48; });
    function Example() { const [text, setText] = useState('short'); return createElement(AutoTextarea, { ref: reference, name: 'caption', rows: 2, value: text, style: { boxSizing: 'border-box', borderTopWidth: '1px', borderBottomWidth: '1px' }, onChange: event => { change(); setText(event.target.value); } }); }
    await act(async () => root.render(createElement(Example)));
    const field = reference.current!; expect(field.name).toBe('caption'); expect(field.style.resize).toBe('none'); expect(field.style.height).toBe('50px');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(field, 'A much longer example caption'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(change).toHaveBeenCalledOnce(); expect(field.style.height).toBe('162px');
    await act(async () => { setValue.call(field, 'short'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(field.style.height).toBe('50px'); expect(field.value).toBe('short');
  });
});
