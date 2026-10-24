import { accountHttp } from '@/modules/settings/server/account-http';
export const runtime = 'nodejs';
export const GET = (request: Request) => accountHttp(request, 'sessions');
export const DELETE = (request: Request) => accountHttp(request, 'revoke');
