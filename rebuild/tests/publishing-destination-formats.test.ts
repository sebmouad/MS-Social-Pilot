import { describe, expect, it } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
import { parseDestinationFormats, resolveDestinationFormat } from '../src/modules/publishing/destination-formats';

const reject = (work: () => unknown) => expect(work).toThrowError(OperationError);

describe('destination format intent', () => {
  it('parses only selected destination keys and safely retains opaque values', () => {
    const result = parseDestinationFormats({ 'target-a': 'format/opaque', 'target-b': 'other-format' }, ['target-a', 'target-b'], 2);
    expect({ ...result }).toEqual({ 'target-a': 'format/opaque', 'target-b': 'other-format' });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(parseDestinationFormats(undefined, ['target-a'], 1)).toEqual(Object.create(null));
    expect(parseDestinationFormats(null, [], 0)).toEqual(Object.create(null));
  });

  it('rejects non-plain, out-of-scope, stale, oversized and malformed values', () => {
    reject(() => parseDestinationFormats([], ['target-a'], 1));
    reject(() => parseDestinationFormats(new Date(), ['target-a'], 1));
    reject(() => parseDestinationFormats({ 'target-a': 'post', 'target-stale': 'post' }, ['target-a'], 2));
    reject(() => parseDestinationFormats({ 'target-a': ' ' }, ['target-a'], 1));
    reject(() => parseDestinationFormats({ 'target-a': 'x'.repeat(129) }, ['target-a'], 1));
    reject(() => parseDestinationFormats({ 'target-a': 12 }, ['target-a'], 1));
    reject(() => parseDestinationFormats({ 'target-a': 'post' }, ['target-a', 'target-a'], 2));
    reject(() => parseDestinationFormats({ 'target-a': 'post', 'target-b': 'post' }, ['target-a', 'target-b'], 1));
    const malicious = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(malicious, '__proto__', { value: 'post', enumerable: true });
    reject(() => parseDestinationFormats(malicious, ['target-a'], 1));
    const scoped = Object.create({ 'target-a': 'post' });
    reject(() => parseDestinationFormats(scoped, ['target-a'], 1));
  });

  it('resolves explicit, stored, legacy and default values in order', () => {
    expect(resolveDestinationFormat({ explicit: 'new', stored: 'stored', legacy: 'legacy', defaultId: 'default' })).toBe('new');
    expect(resolveDestinationFormat({ stored: 'stored', legacy: 'legacy', defaultId: 'default' })).toBe('stored');
    expect(resolveDestinationFormat({ legacy: 'legacy', defaultId: 'default' })).toBe('legacy');
    expect(resolveDestinationFormat({ defaultId: 'default' })).toBe('default');
  });

  it('never silently falls back from an invalid explicit or stored value', () => {
    reject(() => resolveDestinationFormat({ explicit: '', legacy: 'legacy', defaultId: 'default' }));
    reject(() => resolveDestinationFormat({ explicit: 'x'.repeat(129), defaultId: 'default' }));
    reject(() => resolveDestinationFormat({ stored: ' ', defaultId: 'default' }));
    reject(() => resolveDestinationFormat({ defaultId: undefined }));
  });
});
