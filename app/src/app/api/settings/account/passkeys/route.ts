import { accountHttp } from '@/modules/settings/server/account-http';
export const DELETE = (request: Request) => accountHttp(request, 'remove');
