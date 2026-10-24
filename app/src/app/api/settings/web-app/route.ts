import { webAppHttp } from '@/modules/settings/web-app/http';
export const GET = (request: Request) => webAppHttp(request);
export const POST = (request: Request) => webAppHttp(request, true);
