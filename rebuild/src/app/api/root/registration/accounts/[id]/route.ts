import { controlRootRegistrationAccount } from '@/server/root/registration-admin';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export const DELETE = rootRoute<Context>({ write: true }, async (request, actorId, { params }) => controlRootRegistrationAccount(actorId, (await params).id, 'delete', await readBody(request)));
export const POST = rootRoute<Context>({ write: true }, async (request, actorId, { params }) => controlRootRegistrationAccount(actorId, (await params).id, 'resend', await readBody(request)));
