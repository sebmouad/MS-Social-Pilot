"use client";
import { useRef, useState } from 'react';
import { IconRefresh, IconAdjustments, IconPlugConnectedX } from '@tabler/icons-react';
import { Menu, useToast } from '@/components';

export function ConnectionRowMenu({ id, name, platformId, manageLabel, disconnectLabel, actionsLabel, reconnectLabel, busyLabel, failedLabel }: { id: string; name: string; platformId: string; manageLabel: string; disconnectLabel: string; actionsLabel: string; reconnectLabel: string; busyLabel: string; failedLabel: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function reconnect() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/oauth/connections/${encodeURIComponent(platformId)}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `START CONNECTION ${platformId}` }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.authorizationUrl !== 'string') throw new Error();
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error();
      toast.notify({ title: busyLabel, tone: 'info' });
      window.location.assign(url.toString());
    } catch { toast.failed(failedLabel, () => void reconnect(), reconnectLabel); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const navigate = (action: string) => window.location.assign(`/settings/connections?source=${encodeURIComponent(id)}&action=${action}`);
  return <Menu label={`${actionsLabel}: ${name}`} items={[
    { key: 'refresh', label: busy ? busyLabel : reconnectLabel, icon: <IconRefresh size={16} />, disabled: busy, onSelect: () => void reconnect() },
    { key: 'manage', label: manageLabel, icon: <IconAdjustments size={16} />, disabled: busy, onSelect: () => navigate('manage') },
    { key: 'disconnect', label: disconnectLabel, icon: <IconPlugConnectedX size={16} />, disabled: busy, danger: true, onSelect: () => navigate('disconnect') },
  ]} />;
}
