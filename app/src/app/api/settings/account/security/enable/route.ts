import { accountHttp } from '@/modules/settings/server/account-http';
export const POST = (request: Request) => accountHttp(request, 'enable');
