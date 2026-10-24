import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { transferInstallationOwnership } from '@/modules/root/server/admin/transfer';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
const schema = z.object({ email: z.string().min(3).refine(withinSynchronousLimit('root.emailMaxCharacters')), confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();

/** Hand Root to another active account; see transferInstallationOwnership. */
export const POST = rootRoute({ write: true }, async (request, actorId) => transferInstallationOwnership(actorId, schema.parse(await readBody(request))));
