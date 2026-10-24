import { enterShare } from '@/modules/sharing/server/public-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };
const entry = async (request: Request, context: Context) => enterShare(request, (await context.params).token);
export const GET = entry;
export const HEAD = entry;
