'use client';
import { useState, type ReactNode } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Drawer } from '@/components/Drawer';
import { SidePanel } from '@/components/SidePanel';

/** A « New … » button that opens a creation form in a drawer, so a Manage tab shows only its list. */
export function CreateDrawer({ label, closeLabel, description, children, wide = false }: { label: string; closeLabel: string; description?: string; children: ReactNode; /** A centered window instead of the narrow drawer, for forms that show a preview beside their fields. */ wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="primary" size="sm" leading={<IconPlus size={16} />} onClick={() => setOpen(true)}>{label}</Button>
    {wide ? <SidePanel open={open} title={label} closeLabel={closeLabel} onClose={() => setOpen(false)}>{children}</SidePanel> :
    <Drawer open={open} title={label} closeLabel={closeLabel} onClose={() => setOpen(false)} {...(description ? { description } : {})}>{children}</Drawer>}
  </>;
}
