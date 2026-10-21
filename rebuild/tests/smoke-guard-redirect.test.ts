import { describe, expect, it } from 'vitest';
import { OperationError, operationFailure } from '../src/lib/operation-error';

const redirect = (to: string) => Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });

describe('session guard redirects inside API handlers', () => {
  it('answer a missing session with 401, not an upstream failure', () => {
    expect(operationFailure(redirect('/sign-in'), 'Could not load.')).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(operationFailure(redirect('/no-workspace'), 'Could not load.')).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('answer a signed-in member without access with 403', () => {
    expect(operationFailure(redirect('/access-limited'), 'Could not load.')).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('never expose the redirect digest and keep other failures unchanged', () => {
    expect(JSON.stringify(operationFailure(redirect('/sign-in'), 'x'))).not.toMatch(/NEXT_REDIRECT|digest/);
    expect(operationFailure(new Error('boom'), 'Could not load.')).toEqual({ error: 'Could not load.', code: 'upstream_failure', status: 502 });
    expect(operationFailure(new OperationError('not_found', 'Gone.'), 'x')).toMatchObject({ status: 404 });
  });
});
