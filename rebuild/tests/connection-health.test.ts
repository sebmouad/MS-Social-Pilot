import { describe, expect, it } from 'vitest';
import { connectionHealthCopy, connectionHealthText, connectionTokenStatus, summarizeConnectionHealth } from '@/lib/connection-health';
import { facebookConnectionCopy, facebookGrantGroups, parseGrantedScopes, type FacebookGrantRequirements } from '@/platforms/facebook/connection-health';

const now = new Date('2026-10-19T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('connection token status', () => {
  it('is valid without an expiry or far from it', () => {
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: null }, now)).toBe('valid');
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: days(60) }, now)).toBe('valid');
  });
  it('warns inside the window and expires at the boundary', () => {
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: days(7) }, now)).toBe('expiring_soon');
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: days(7.01) }, now)).toBe('valid');
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: now }, now)).toBe('expired');
    expect(connectionTokenStatus({ invalidatedAt: null, tokenExpiresAt: days(2) }, now, 1)).toBe('valid');
  });
  it('treats an invalidated connection as reconnect needed even before expiry', () => {
    expect(connectionTokenStatus({ invalidatedAt: days(-1), tokenExpiresAt: days(60) }, now)).toBe('reconnect_needed');
  });
});

describe('summary', () => {
  it('recommends reconnecting for missing grants or a weak token, not for unknown grants alone', () => {
    const valid = { invalidatedAt: null, tokenExpiresAt: days(60) };
    expect(summarizeConnectionHealth(valid, [{ id: 'a', label: 'A', state: 'granted' }], now).reconnectRecommended).toBe(false);
    expect(summarizeConnectionHealth(valid, [{ id: 'a', label: 'A', state: 'unknown' }], now).reconnectRecommended).toBe(false);
    const missing = summarizeConnectionHealth(valid, [{ id: 'a', label: 'A', state: 'missing' }], now);
    expect(missing.reconnectRecommended).toBe(true);
    expect(missing.missing.map(group => group.id)).toEqual(['a']);
    expect(summarizeConnectionHealth({ invalidatedAt: null, tokenExpiresAt: days(1) }, [], now).reconnectRecommended).toBe(true);
    expect(summarizeConnectionHealth(valid, [], now).checkedAt).toBe(now);
  });
});

const requirements: FacebookGrantRequirements = {
  publishing: ['pages_manage_posts'], deleting: ['pages_manage_posts'], firstComment: ['pages_manage_engagement'], postStatus: ['pages_read_engagement'],
  insights: ['read_insights', 'pages_read_engagement'], inboxRead: ['pages_messaging'], inboxWrite: ['pages_manage_engagement'],
  adsReporting: ['ads_read'], adsManagement: ['ads_management'], adsManagementEnabled: false,
};

describe('Facebook grant groups', () => {
  it('parses comma or space separated stored scopes', () => {
    expect(parseGrantedScopes('a,b c, d')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseGrantedScopes('')).toEqual([]);
    expect(parseGrantedScopes(null)).toEqual([]);
  });
  it('reports granted and missing areas in customer words without scope names', () => {
    const groups = facebookGrantGroups('pages_manage_posts,pages_read_engagement,read_insights', requirements, { hasAdAccounts: false });
    const byId = Object.fromEntries(groups.map(group => [group.id, group]));
    expect(byId.publishing.state).toBe('granted');
    expect(byId.firstComment.state).toBe('missing');
    expect(byId.inbox.state).toBe('missing');
    expect(byId.insights.state).toBe('granted');
    expect(byId.adsReporting).toBeUndefined();
    for (const group of groups) expect(group.label).not.toMatch(/_|pages|ads_/);
  });
  it('treats an unrecorded grant list as unknown, never missing', () => {
    expect(facebookGrantGroups('', requirements, { hasAdAccounts: false }).every(group => group.state === 'unknown')).toBe(true);
  });
  it('includes ads areas only for connections with ad accounts, and management only when enabled', () => {
    const ids = (enabled: boolean) => facebookGrantGroups('ads_read', { ...requirements, adsManagementEnabled: enabled }, { hasAdAccounts: true }).map(group => group.id);
    expect(ids(false)).toContain('adsReporting');
    expect(ids(false)).not.toContain('adsManagement');
    expect(ids(true)).toContain('adsManagement');
    expect(facebookGrantGroups('ads_read', { ...requirements, adsManagementEnabled: true }, { hasAdAccounts: true }).find(group => group.id === 'adsManagement')?.state).toBe('missing');
  });
  it('skips areas Root configured with no scopes', () => {
    expect(facebookGrantGroups('x', { ...requirements, deleting: [] }, { hasAdAccounts: false }).some(group => group.id === 'deleting')).toBe(false);
  });
  it('localizes group labels', () => {
    const [first] = facebookGrantGroups('pages_manage_posts', requirements, { hasAdAccounts: false, locale: 'fr' });
    expect(first.label).toBe(facebookConnectionCopy.fr.publishing);
  });
});

describe('copy catalogs', () => {
  it('has the same keys in English and French', () => {
    expect(Object.keys(connectionHealthCopy.fr).sort()).toEqual(Object.keys(connectionHealthCopy.en).sort());
    expect(Object.keys(facebookConnectionCopy.fr).sort()).toEqual(Object.keys(facebookConnectionCopy.en).sort());
  });
  it('fills placeholders', () => {
    expect(connectionHealthText('fr', 'missingSummary', { labels: 'X' })).toBe('Manquant : X');
  });
});
