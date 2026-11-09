'use client';
import { useState, type ReactNode } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Drawer } from '@/components/Drawer';

/** A « New … » button that opens a creation form in a drawer, so a Manage tab shows only its list. */
export function CreateDrawer({ label, closeLabel, description, children }: { label: string; closeLabel: string; description?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="primary" size="sm" leading={<IconPlus size={16} />} onClick={() => setOpen(true)}>{label}</Button>
    <Drawer open={open} title={label} closeLabel={closeLabel} onClose={() => setOpen(false)} {...(description ? { description } : {})}>{children}</Drawer>
  </>;
}
