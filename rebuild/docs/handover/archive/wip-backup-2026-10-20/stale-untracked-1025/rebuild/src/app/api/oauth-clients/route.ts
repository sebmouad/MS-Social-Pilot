import { handlePublic, jsonBody } from '@/modules/integrations/http';
import { clientIp } from '@/server/client-ip';
import { registerClient } from '@/modules/integrations/server/oauth';
export const dynamic = 'force-dynamic';
/** Dynamic client registration (RFC 7591 shaped). Public by protocol; throttled per caller address and bounded by Root limits. */
export const POST = (request: Request) => handlePublic({ success: 201, fallback: 'Registration is unavailable right now.', run: async () => registerClient(await jsonBody(request), clientIp(request) ?? 'unknown') });
