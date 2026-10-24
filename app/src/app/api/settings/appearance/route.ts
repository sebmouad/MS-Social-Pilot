import { appearanceHttp } from '@/modules/settings/server/appearance-http';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => appearanceHttp(request);
export const PATCH = (request: Request) => appearanceHttp(request, true);
