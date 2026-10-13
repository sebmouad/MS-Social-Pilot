import { describe, expect, it } from 'vitest';
import { composerFieldErrors, destinationContent, initialComposeTiming, stableFields } from '../src/lib/composer-state';
describe('composer destination and intent', () => {
  it('previews destination override and media exclusion together', () => {
    const media = [{ id: 'image', kind: 'image', url: '/image' }] as Parameters<typeof destinationContent>[2];
    expect(destinationContent('one', 'shared', media, { one: 'local' }, ['one'])).toEqual({ message: 'local', media: [] });
    expect(destinationContent('two', 'shared', media, { two: '  ' }, ['one'])).toEqual({ message: 'shared', media });
  });
  it('queue links retain intent only when queue exists', () => {
    expect(initialComposeTiming('queue', true)).toBe('queue');
    expect(initialComposeTiming('queue', false)).toBe('schedule');
    expect(initialComposeTiming(undefined, true)).toBe('schedule');
  });
  it('detects custom fields independent of ordering', () => {
    expect(stableFields({ b: 'two', a: 'one' })).toBe(stableFields({ a: 'one', b: 'two' }));
    expect(stableFields({ a: 'one' })).not.toBe(stableFields({ a: 'changed' }));
  });
});

it('maps server scheduling errors to the actual control', () => { expect(composerFieldErrors({ scheduledAtLocal: 'Future required', targetIds: 'Pick one' })).toEqual({ scheduledAt: 'Future required', targetIds: 'Pick one' }); });
