'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import { useState, type ComponentProps } from 'react';
import { IconUpload } from '@tabler/icons-react';
import { Button, Drawer } from '@/components';
import { type KitLocale } from '../kit/copy';
import { CsvImportForm } from './PostActions';

/** CSV import opens beside the list in a drawer, so the posts stay in view. */
export function ImportCsv({ targets, locale = 'en' }: { targets: ComponentProps<typeof CsvImportForm>['targets']; locale?: KitLocale }) {
  const [open, setOpen] = useState(false);
  const copy = usePublishingCopy(locale);
  return <>
    <Button variant="secondary" leading={<IconUpload size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>{copy.importCsv}</Button>
    <Drawer open={open} title={copy.importCsv} description={copy.importHelp} closeLabel={copy.close} onClose={() => setOpen(false)}>
      <CsvImportForm targets={targets} />
    </Drawer>
  </>;
}
