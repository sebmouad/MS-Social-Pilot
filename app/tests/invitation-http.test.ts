import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  preview: vi.fn(), accept: vi.fn(), register: vi.fn(),
  beginEnrollment: vi.fn(), clearToken: vi.fn(), readToken: vi.fn(), rememberToken: vi.fn(), account: vi.fn(),
  runtimeConfig: vi.fn(), authRateLimit: vi.fn(), cookieSets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: (name: string, value: string, options: Record<string, unknown>) => state.cookieSets.push({ name, value, options }) }) }));
vi.mock('@/modules/settings/server/invitations', () => ({ previewTeamInvitation: state.preview, acceptTeamInvitation: state.accept, registerTeamInvitation: state.register }));
vi.mock('@/server/invitation-session', () => ({ beginInvitationEnrollment: state.beginEnrollment, clearInvitationToken: state.clearToken, readInvitationToken: state.readToken, rememberInvitationToken: state.rememberToken, signedInInvitationAccount: state.account }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('@/server/auth-flow', () => ({ authRateLimit: state.authRateLimit }));
vi.mock('@/server/rate-limit', () => ({ hit: () => ({ allowed: true }) }));
vi.mock('@/server/client-ip', () => ({ clientIp: () => '127.0.0.1' }));

import { handleInvitationHttp } from '@/server/invitation-http';
import { OperationError } from '@/lib/operation-error';

const origin = 'https://social.example';
const token = Buffer.alloc(32, 3).toString('base64url');
const invitation = { id: 'invite-1', email: 'member@example.test', role: 'admin', workspaceId: 'workspace-1', workspaceName: 'Example', expiresAt: new Date(Date.now() + 60_000), existingAccount: true };
function request(action: string, body: unknown, headers: Record<string, string> = { origin }) {
  return new Request(`${origin}/api/auth/invitations/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.cookieSets = [];
  state.preview.mockResolvedValue(invitation); state.accept.mockResolvedValue({ workspaceId: invitation.workspaceId, joined: true });
  state.register.mockResolvedValue({ created: true, workspaceId: invitation.workspaceId });
  state.beginEnrollment.mockResolvedValue(undefined); state.clearToken.mockResolvedValue(undefined);
  state.readToken.mockResolvedValue(token); state.rememberToken.mockResolvedValue(undefined);
  state.account.mockResolvedValue(null); state.runtimeConfig.mockResolvedValue('admins');
  state.authRateLimit.mockResolvedValue({ limit: 20, windowMs: 60000 });
});

describe('invitation HTTP continuation', () => {
  it('returns an empty no-store preview when neither a fragment nor continuation token exists', async () => {
    state.readToken.mockResolvedValue(null);
    const response = await handleInvitationHttp(request('preview', {}), 'preview');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invitation: null });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.account).not.toHaveBeenCalled();
    expect(state.rememberToken).not.toHaveBeenCalled();
  });

  it('normalizes a missing preview without changing unavailable or forbidden invitation responses', async () => {
    state.preview.mockRejectedValueOnce(new OperationError('not_found', 'Unavailable'));
    const missing = await handleInvitationHttp(request('preview', { token }), 'preview');
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ invitation: null });
    for (const [code, status] of [['conflict', 409], ['forbidden', 403]] as const) {
      state.preview.mockRejectedValueOnce(new OperationError(code, 'Unavailable'));
      expect((await handleInvitationHttp(request('preview', { token }), 'preview')).status).toBe(status);
    }
    expect(state.rememberToken).not.toHaveBeenCalled();
  });

  it('keeps tokenless writes rejected and malformed previews invalid', async () => {
    state.readToken.mockResolvedValue(null);
    for (const action of ['accept', 'enroll', 'register'] as const) {
      const body = action === 'register' ? { name: 'Member', password: 'long-password', confirmation: 'CREATE ACCOUNT AND JOIN invite-1' } : { confirmation: 'CONFIRM' };
      expect((await handleInvitationHttp(request(action, body), action)).status).toBe(404);
    }
    expect((await handleInvitationHttp(request('preview', { token: 'bad-token' }), 'preview')).status).toBe(400);
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
    expect(state.beginEnrollment).not.toHaveBeenCalled();
  });

  it('requires same-origin requests before preview or token work', async () => {
    const response = await handleInvitationHttp(request('preview', { token }, { origin: 'https://attacker.example' }), 'preview');
    expect(response.status).toBe(403);
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.rememberToken).not.toHaveBeenCalled();
  });

  it('accepts invitation tokens from the fragment body, stores continuation, and never returns the token', async () => {
    const response = await handleInvitationHttp(request('preview', { token }), 'preview');
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(state.preview).toHaveBeenCalledWith(token);
    expect(state.rememberToken).toHaveBeenCalledWith(token, invitation.expiresAt);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects a different signed-in email and does not accept the invitation', async () => {
    state.account.mockResolvedValue({ id: 'user-1', email: 'other@example.test', sessionId: 'session-1', totpEnabled: true, hasPasskey: false, isInstanceOwner: false });
    const response = await handleInvitationHttp(request('accept', { confirmation: 'ACCEPT INVITATION invite-1' }), 'accept');
    expect(response.status).toBe(403);
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.clearToken).not.toHaveBeenCalled();
  });

  it('returns an acceptance receipt and switches workspace only after service confirmation', async () => {
    state.account.mockResolvedValue({ id: 'user-1', email: invitation.email, sessionId: 'session-1', totpEnabled: true, hasPasskey: false, isInstanceOwner: false });
    const response = await handleInvitationHttp(request('accept', { confirmation: 'ACCEPT INVITATION invite-1' }), 'accept');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, joined: true, workspaceId: 'workspace-1', next: '/home' });
    expect(state.accept).toHaveBeenCalledWith(token, 'user-1', 'ACCEPT INVITATION invite-1');
    expect(state.clearToken).toHaveBeenCalledOnce();
    expect(state.cookieSets).toContainEqual(expect.objectContaining({ name: 'sp_workspace', value: 'workspace-1' }));
  });

  it('routes a factorless invited admin into enrollment without accepting membership', async () => {
    state.account.mockResolvedValue({ id: 'user-1', email: invitation.email, sessionId: 'session-1', totpEnabled: false, hasPasskey: false, isInstanceOwner: false });
    const response = await handleInvitationHttp(request('enroll', { confirmation: 'ENROLL FOR INVITATION invite-1' }), 'enroll');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, next: '/two-step/enroll' });
    expect(state.beginEnrollment).toHaveBeenCalledOnce();
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.clearToken).not.toHaveBeenCalled();
  });

  it('sends only the invited recipient-bound registration details to the registration service', async () => {
    const details = { name: 'Member', password: 'long-password', confirmation: 'CREATE ACCOUNT AND JOIN invite-1' };
    const response = await handleInvitationHttp(request('register', details), 'register');
    expect(response.status).toBe(200);
    expect(state.register).toHaveBeenCalledWith({ ...details, token });
    expect(state.clearToken).toHaveBeenCalledOnce();
  });
});
