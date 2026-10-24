import { handleInvitationHttp } from '@/server/invitation-http';
export const runtime = 'nodejs';
export const POST = (request: Request) => handleInvitationHttp(request, 'accept');
