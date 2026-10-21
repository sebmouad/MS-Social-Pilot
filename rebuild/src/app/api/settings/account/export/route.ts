import { accountHttp } from '@/modules/settings/server/account-http';
export const runtime = 'nodejs';
export const GET = (request: Request) => accountHttp(request, 'export');
