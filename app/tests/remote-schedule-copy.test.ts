import { describe, expect, it } from 'vitest';
import { holdsRemotely, leadLabel, remoteScheduleCopy } from '@/modules/publishing/ui/compose/remote-copy';

describe('platform-held scheduling choice copy', () => {
  it('is offered only for formats that declare both support and a lead window', () => {
    expect(holdsRemotely({ scheduling: { application: true, native: true, nativeLeadSeconds: { min: 600, max: 6480000 } } })).toBe(true);
    expect(holdsRemotely({ scheduling: { application: true, native: true } })).toBe(false);
    expect(holdsRemotely({ scheduling: { application: true, native: false, nativeLeadSeconds: { min: 600, max: 6480000 } } })).toBe(false);
    expect(holdsRemotely(undefined)).toBe(false);
  });

  it('names lead times in whole minutes, hours or days in both languages', () => {
    expect(leadLabel(600, 'en')).toBe('10 minutes');
    expect(leadLabel(7200, 'en')).toBe('2 hours');
    expect(leadLabel(6480000, 'en')).toBe('75 days');
    expect(leadLabel(6480000, 'fr')).toBe('75 jours');
    expect(leadLabel(30, 'en')).toBe('1 minute');
  });

  it('has the same keys in English and French and no operator vocabulary', () => {
    expect(Object.keys(remoteScheduleCopy.fr).sort()).toEqual(Object.keys(remoteScheduleCopy.en).sort());
    expect(JSON.stringify(remoteScheduleCopy)).not.toMatch(/graph|token|scope|api|native|meta/i);
  });
});
