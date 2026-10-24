import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { configuredFacebookEngine, configuredFacebookOAuth, configuredFacebookNativeSettings } from './runtime';
import { FacebookApiError } from './publishing';
import { facebookModule } from './module';
import { fail, pass, skipped, type CheckOutcome, type PlatformDiagnostics } from '@/server/diagnostics/types';

function safeFacebookFailure(error: unknown): CheckOutcome {
  if (error instanceof FacebookApiError && error.code === 190) return fail('credential_rejected', 'Facebook rejected the connection credential. Reconnect this source and retry.');
  if (error instanceof FacebookApiError && error.retryable) return fail('api_unavailable', 'Facebook could not complete the read within the adapter limits. Check connectivity and retry later.');
  return fail('api_read_failed', 'Facebook API read failed. Review the configured endpoint, credential and permissions. Raw provider errors are withheld.');
}

/** No shared code knows Graph paths, token shape, scopes or identity semantics. */
export const facebookDiagnostics: PlatformDiagnostics = {
  async checks(connectionId) {
    const connection = connectionId ? await prisma.socialAccount.findFirst({
      where: { id: connectionId, provider: facebookModule.id },
      select: { providerUserId: true, accessToken: true, tokenExpiresAt: true, invalidatedAt: true },
    }) : null;
    const eligible = () => !connectionId ? skipped('choose_connection', 'Select a connection in the sidebar to run authenticated API reads.')
      : !connection ? fail('connection_missing', 'Selected connection is no longer available for this platform.')
        : connection.invalidatedAt || connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date() ? fail('reconnect_required', 'Connection is revoked or expired. Reconnect before testing the API.') : null;
    return [
      { id: 'native_configuration', label: 'Native publishing policy', async run() {
        try { await configuredFacebookNativeSettings(); return pass('native_policy_valid', 'Native transport trust and format limits are valid locally. Native formats remain unavailable; no provider request was sent.'); }
        catch { return fail('native_policy_invalid', 'Review native publishing transport and format limits in this platform’s settings. No provider request was sent.'); }
      } },
      { id: 'connection_setup', label: 'Connection configuration', async run() {
        try { await configuredFacebookOAuth(); return pass('connection_configured', 'Application credentials, redirect and requested scopes are present. Provider approval and remote credential validity are not verified by this check.'); }
        catch { return fail('connection_unconfigured', 'Review application ID, secret, redirect and requested scopes in this platform’s settings.'); }
      } },
      { id: 'identity', label: 'Authenticated API identity', async run(signal) {
        const unavailable = eligible(); if (unavailable) return unavailable;
        try {
          const engine = await configuredFacebookEngine({ signal });
          const user = await engine.getCurrentUser(decryptSecret(connection!.accessToken));
          return user.id && user.id === connection!.providerUserId ? pass('identity_verified', 'Authenticated API returned the identity stored for this connection. No remote content was changed.') : fail('identity_mismatch', 'API identity does not match the selected connection. Reconnect before using this source.');
        } catch (error) { return safeFacebookFailure(error); }
      } },
      { id: 'grants', label: 'Current requested permissions', async run(signal) {
        const unavailable = eligible(); if (unavailable) return unavailable;
        try {
          const [engine, oauth] = await Promise.all([configuredFacebookEngine({ signal }), configuredFacebookOAuth()]);
          const granted = new Set(await engine.getGrantedPermissions(decryptSecret(connection!.accessToken)));
          const missing = oauth.scopes.filter(scope => !granted.has(scope));
          return missing.length ? fail('grants_missing', `${missing.length} configured requested permission(s) are not currently granted. Review application approval and reconnect.`)
            : pass('requested_grants_verified', 'Configured requested permissions are currently granted. This does not verify each selected channel, ad account or operation.');
        } catch (error) { return safeFacebookFailure(error); }
      } },
      { id: 'channels', label: 'Channel discovery API', async run(signal) {
        const unavailable = eligible(); if (unavailable) return unavailable;
        try {
          const engine = await configuredFacebookEngine({ signal });
          const channels = await engine.discoverPages(decryptSecret(connection!.accessToken));
          return pass('channel_discovery_read', `${channels.length} Page(s) returned within adapter pagination limits. No channels were added. Per-channel publishing and inbox access remain separate checks.`);
        } catch (error) { return safeFacebookFailure(error); }
      } },
      { id: 'ad_accounts', label: 'Ad account discovery API', async run(signal) {
        const unavailable = eligible(); if (unavailable) return unavailable;
        try {
          const engine = await configuredFacebookEngine({ signal });
          const accounts = await engine.discoverAdAccounts(decryptSecret(connection!.accessToken));
          return pass('ad_discovery_read', `${accounts.length} ad account(s) returned within adapter pagination limits. No accounts were added or changed. Reporting and spend-changing access remain separate checks.`);
        } catch (error) { return safeFacebookFailure(error); }
      } },
    ];
  },
};
