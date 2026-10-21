import { accountHttp } from '@/modules/settings/server/account-http';
export const GET = (request: Request) => accountHttp(request, 'security');
