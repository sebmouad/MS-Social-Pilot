import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { describeClientForConsent } from '@/modules/integrations/server/oauth';
import { SettingsPage, SettingsPanel, styles } from '../../_components';
import { ConnectForm } from './ConnectForm';

export const metadata = { title: 'Connect an app' };
type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/** OAuth consent. The redirect address must equal a registered one exactly, otherwise nothing is offered. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const viewer = await requireViewer({ feature: 'settings/mcp', channelScoped: true });
  const frame = (body: React.ReactNode) => <PageFrame module="settings"><SettingsPage active="settings/mcp" title="Connect an app" description="Approve an app that asked to connect to your workspace.">{body}</SettingsPage></PageFrame>;
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return frame(<SettingsPanel title="Access restricted"><p className={styles['settings-note']}>Only workspace owners and admins can connect apps.</p></SettingsPanel>);
  const challenge = one(params.code_challenge);
  if (one(params.response_type) !== 'code' || one(params.code_challenge_method) !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return frame(<SettingsPanel title="Request not valid"><p role="alert" className={styles['settings-note']}>This connection request is incomplete. Return to the app and start again.</p></SettingsPanel>);
  let client: Awaited<ReturnType<typeof describeClientForConsent>>;
  try { client = await describeClientForConsent(one(params.client_id), one(params.redirect_uri)); }
  catch { return frame(<SettingsPanel title="Request not valid"><p role="alert" className={styles['settings-note']}>This connection request is not valid. Return to the app and start again.</p></SettingsPanel>); }
  return frame(<SettingsPanel title={`Connect ${client.name}`}><ConnectForm clientId={client.clientId} name={client.name} host={client.redirectHost} redirectUri={one(params.redirect_uri)} codeChallenge={challenge} state={one(params.state) || null} workspaceName={viewer.membership.workspace.name} /></SettingsPanel>);
}
