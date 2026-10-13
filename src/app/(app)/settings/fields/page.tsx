import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CustomFieldsClient } from '@/components/CustomFieldsClient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { listCustomFields } from '@/lib/custom-fields';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('customFields.title');
}

/** Custom fields on posts: owners and admins. */
export default async function CustomFieldsPage() {
  const auth = await requirePage();
  if (!canManageSettings(auth.role)) notFound();
  const t = await getTranslations('customFields');
  const fields = await listCustomFields(auth.workspace.id);
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <CustomFieldsClient fields={fields.map((field) => ({ id: field.id, name: field.name, kind: field.kind as 'text' | 'choice', options: field.options }))} />
    </div>
  );
}
