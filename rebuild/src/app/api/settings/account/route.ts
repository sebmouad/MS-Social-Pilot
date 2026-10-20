import { accountHttp } from '@/modules/settings/server/account-http';
export const runtime = 'nodejs';
export const GET = (request: Request) => accountHttp(request, 'read');
export const PATCH = (request: Request) => accountHttp(request, 'profile');
export const POST = (request: Request) => accountHttp(request, 'password');
