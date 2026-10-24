import { enterBio } from '@/modules/sharing/server/public-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ slug: string }> };
const entry = async (request: Request, context: Context) => enterBio(request, (await context.params).slug);
export const GET = entry;
export const HEAD = entry;
