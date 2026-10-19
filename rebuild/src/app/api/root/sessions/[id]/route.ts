import { signOutRootSession } from '@/server/root/legacy/sessions';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body: { confirmation: "SIGN OUT SESSION <id>" }. */
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => signOutRootSession(actorId, (await params).id, await readBody(request)));
