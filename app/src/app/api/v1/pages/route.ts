import { handleKey } from '@/modules/integrations/http';
import { restPages } from '@/modules/integrations/server/rest';
export const dynamic = 'force-dynamic';
/** The channels the key may use. Needs the Connections read grant. */
export const GET = (request: Request) => handleKey(request, { need: { feature: 'settings/connections' }, fallback: 'The request could not be completed.', run: ctx => restPages(ctx) });
