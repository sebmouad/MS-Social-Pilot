import { describe, expect, it } from 'vitest';
import { guardVolumeDatabase } from '../scripts/volume-probe';

// A relaxed guard could seed a production database. Importing the module must
// also remain inert: these tests neither construct a client nor connect.
describe('volume probe database guard', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts explicit loopback %s rehearsal databases', host => {
    const url = `postgresql://probe:secret@${host}:5432/volume_rehearsal`;
    expect(guardVolumeDatabase(url, 'test')).toBe(url);
  });
  it.each([
    undefined, '', 'not a url', 'https://localhost/volume_rehearsal',
    'postgresql://db.example/volume_rehearsal',
    'postgresql://localhost.evil.test/volume_rehearsal',
    'postgresql://localhost/production', 'postgresql://localhost/volume_rehearsal_extra',
    'postgresql://localhost/_rehearsal', 'postgresql://localhost/a%2Fb_rehearsal',
    'postgresql://localhost/a_rehearsal?host=remote',
    'postgresql://localhost/a_rehearsal?hostaddr=10.0.0.1',
    'postgresql://localhost/a_rehearsal?socket=/tmp',
    'postgresql://localhost/a_rehearsal?options=-csearch_path=private',
    'postgresql://localhost/a_rehearsal?schema=private',
    'postgresql://localhost/a_rehearsal?HOST=remote',
    'postgresql://localhost/a_rehearsal#ignored',
  ])('rejects unsafe target without leaking its URL (%s)', value => {
    expect(() => guardVolumeDatabase(value, 'test')).toThrow('loopback');
    try { guardVolumeDatabase(value, 'test'); } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('postgresql://');
    }
  });
  it('rejects production execution even on a rehearsal URL', () => {
    expect(() => guardVolumeDatabase('postgresql://localhost/a_rehearsal', 'production')).toThrow('loopback');
  });
});
