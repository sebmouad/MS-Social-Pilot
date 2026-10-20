import { AuthorizeScreen } from '@/modules/integrations/oauth/ui/AuthorizeScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect an app', robots: { index: false } };

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuthorizeScreen searchParams={await searchParams} />;
}
