'use client';
import { useState } from 'react';
import { Select, FilterSection } from '@/components';
import { SidebarDock } from '@/components/SidebarDock';
import { WorkspaceAction } from './WorkspaceAction';
import { uiCopy, type UiLocale } from './copy';

/** Choices are the available, currently scoped workspaces returned by the overview service. */
export function WorkspaceQuickSwitch({ workspaces, locale = 'en' }: { workspaces: Array<{ id: string; name: string }>; locale?: UiLocale }) {
  const [selected, setSelected] = useState('');
  const t = uiCopy(locale);
  const workspace = workspaces.find(item => item.id === selected);
  if (!workspaces.length) return null;
  return <SidebarDock><FilterSection label={t('Quick switch')}>
    <Select searchLabel={t('Search')} noMatchLabel={t('No match')} aria-label={t('Shown workspaces')} value={workspace?.id ?? ''} onChange={setSelected} options={[{ value: '', label: t('Choose a workspace') }, ...workspaces.map(item => ({ value: item.id, label: item.name }))]} searchable />
    {workspace && <WorkspaceAction key={workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} href="/home" label={t('Open workspace')} locale={locale} />}
  </FilterSection></SidebarDock>;
}
