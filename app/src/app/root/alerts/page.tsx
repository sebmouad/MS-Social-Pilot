import { redirect } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
export default async function AlertsPage() {
  await requireRootPage();
  redirect('/root/operations');
}
