import { handlePublic, jsonOrFormBody } from '@/modules/integrations/http';
import { exchangeCode } from '@/modules/integrations/server/oauth';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => handlePublic({ fallback: 'The token request could not be completed.', run: async () => exchangeCode(await jsonOrFormBody(request)) });
