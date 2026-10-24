"use client";
import { useRef, useState } from 'react';
import { IconRefresh, IconAdjustments, IconPlugConnectedX } from '@tabler/icons-react';
import { Button, Menu, useToast } from '@/components';
import styles from './connections.module.css';

type Labels = { manageLabel: string; disconnectLabel: string; actionsLabel: string; reconnectLabel: string; busyLabel: string; failedLabel: string };

/** Starts the platform's own authorization again; the module decides what it asks for. */
function useReconnect(platformId: string, labels: Pick<Labels, 'busyLabel' | 'failedLabel' | 'reconnectLabel'>) {
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
      toast.notify({ title: labels.busyLabel, tone: 'info' });
      window.location.assign(url.toString());
    } catch { toast.failed(labels.failedLabel, () => void reconnect(), labels.reconnectLabel); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, reconnect };
}

const navigate = (id: string, action: string) => window.location.assign(`/settings/channels?source=${encodeURIComponent(id)}&action=${action}`);

export function ConnectionRowMenu({ id, name, platformId, manageLabel, disconnectLabel, actionsLabel, reconnectLabel, busyLabel, failedLabel }: { id: string; name: string; platformId: string } & Labels) {
  const { busy, reconnect } = useReconnect(platformId, { busyLabel, failedLabel, reconnectLabel });
  return <Menu label={`${actionsLabel}: ${name}`} items={[
    { key: 'refresh', label: busy ? busyLabel : reconnectLabel, icon: <IconRefresh size={16} />, disabled: busy, onSelect: () => void reconnect() },
    { key: 'manage', label: manageLabel, icon: <IconAdjustments size={16} />, disabled: busy, onSelect: () => navigate(id, 'manage') },
    { key: 'disconnect', label: disconnectLabel, icon: <IconPlugConnectedX size={16} />, disabled: busy, danger: true, onSelect: () => navigate(id, 'disconnect') },
  ]} />;
}

/** Account card buttons: [Manage channels] [Reconnect] and "⋯" with Disconnect (the retain-or-delete dialog stays unchanged). */
export function ChannelCardActions({ id, name, platformId, needsReconnect: _needsReconnect, ...labels }: { id: string; name: string; platformId: string; needsReconnect: boolean } & Labels) {
  const { busy, reconnect } = useReconnect(platformId, labels);
  return <div className={styles.cardActions}>
    <Button variant="secondary" size="sm" onClick={() => navigate(id, 'manage')} disabled={busy}>{labels.manageLabel}</Button>
    <Button variant="secondary" size="sm" onClick={() => void reconnect()} disabled={busy}>{busy ? labels.busyLabel : labels.reconnectLabel}</Button>
    <Menu label={`${labels.actionsLabel}: ${name}`} items={[{ key: 'disconnect', label: labels.disconnectLabel, icon: <IconPlugConnectedX size={16} />, disabled: busy, danger: true, onSelect: () => navigate(id, 'disconnect') }]} />
  </div>;
}
