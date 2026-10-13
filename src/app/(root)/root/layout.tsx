import { ConfirmProvider } from '@/components/ConfirmProvider';
import { RootShell } from '@/components/RootShell';
import { requireRoot } from '@/lib/auth';

/**
 * The root section: the installation's owner only, apart from every workspace.
 * Anyone else gets a 404 here and on every `/api/root/*` route, so the section
 * is not advertised (docs/PERMISSIONS.md).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireRoot();
  return (
    <ConfirmProvider>
      <RootShell userName={auth.user.name}>{children}</RootShell>
    </ConfirmProvider>
  );
}
