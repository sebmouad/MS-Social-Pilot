import { signOutRootSession } from '@/modules/root/server/admin/sessions';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body: { confirmation: "SIGN OUT SESSION <id>" }. */
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => signOutRootSession(actorId, (await params).id, await readBody(request)));
