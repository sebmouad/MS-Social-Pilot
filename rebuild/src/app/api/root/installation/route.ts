import { z } from 'zod';
import { transferInstallationOwnership } from '@/server/root/legacy/transfer';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
const schema = z.object({ email: z.string().min(3).max(320), confirmation: z.string().min(1).max(400) }).strict();

/** Hand Root to another active account; see transferInstallationOwnership. */
export const POST = rootRoute({ write: true }, async (request, actorId) => transferInstallationOwnership(actorId, schema.parse(await readBody(request))));
