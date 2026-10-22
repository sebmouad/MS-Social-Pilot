import { Badge } from '@/components/Badge';
import { IconPlugConnected, IconCircleCheck } from '@tabler/icons-react';
import { PageHeader } from '@/components/PageHeader';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { requireRootPage } from '@/server/config/access';
import { platformStatuses } from '@/server/platforms/registry';
import type { CapabilityDeclaration } from '@/platforms/types';
import { PlatformSwitch } from './PlatformSwitch';
import './platforms.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platforms · Root' };

const CAPABILITY_LABELS: Record<keyof CapabilityDeclaration, string> = {
  connection: 'Connect', discovery: 'Discover channels', publishing: 'Publish', remoteStatus: 'Publish status',
  remoteDelete: 'Delete on platform', inbox: 'Inbox', analytics: 'Analytics', ads: 'Ads',
};

export default async function RootPlatformsPage() {
  await requireRootPage();
  const statuses = await platformStatuses();
  return <RootFrame active="/root/platforms">
    <PageHeader module="root" title="Platform modules" description={<>Each social platform is a module. Switch a module on to offer it to workspaces; switch it off to hide it everywhere. Connected data stays stored either way.</>} />
    <ul className="root-platforms">{statuses.map(({ module, enabled, ready }) => {
      const supported = (Object.keys(CAPABILITY_LABELS) as (keyof CapabilityDeclaration)[]).filter(key => module.capabilities[key] === 'supported');
      const state = !enabled ? { label: 'Off', tone: 'off' } : ready ? { label: 'On · customers can connect', tone: 'good' } : { label: 'On · setup incomplete', tone: 'warning' };
      return <li key={module.id} className="root-platform">
        <span aria-hidden="true" className="root-platform__mark" style={{ background: module.mark.color }}>{module.mark.text}</span>
        <div className="root-platform__body">
          <h2>{module.name}</h2>
          <p>{module.description}</p>
          <Badge tone={state.tone === 'good' ? 'success' : state.tone === 'off' ? 'neutral' : 'warning'} icon={<IconPlugConnected size={14} />}>{state.label}</Badge>
          {enabled && !ready && <p className="root-platform__hint">Fill in the {module.name} app credentials in <a href={`/root/platforms/${module.id}`}>{module.name} settings</a> ({module.settingsGroup} groups) so customers can connect.</p>}
          <ul className="root-platform__capabilities" aria-label={`${module.name} capabilities`}>{supported.map(key => <li key={key}><Badge tone="brand" icon={<IconCircleCheck size={14} />}>{CAPABILITY_LABELS[key]}</Badge></li>)}</ul>
        </div>
        <div className="root-platform__actions">
          <PlatformSwitch settingKey={module.enabledKey} name={module.name} enabled={enabled} />
          <a href={`/root/platforms/${module.id}`}>Manage {module.name}</a>
        </div>
      </li>;
    })}</ul>
  </RootFrame>;
}
