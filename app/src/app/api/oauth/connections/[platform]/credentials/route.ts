import { connectionCredentialFormHttp, connectionCredentialsHttp } from '@/modules/settings/server/connection-credentials-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Credential-entry form description for providers connected without a redirect. Session only. */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return connectionCredentialFormHttp(request, (await params).platform);
}
/** Verify and store a credential (app password, bot token). Session only; exact confirmation required. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return connectionCredentialsHttp(request, (await params).platform);
}
