import { handleKey } from '@/modules/integrations/http';
import { restMe } from '@/modules/integrations/server/rest';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleKey(request, { fallback: 'The request could not be completed.', run: ctx => restMe(ctx) });
