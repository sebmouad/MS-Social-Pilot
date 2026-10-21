import { renameRootWorkspace } from '@/server/root/workspace-controls';
import { rootRoute } from '@/server/root/legacy/http';
import { z } from 'zod';
export const runtime = 'nodejs';
const schema = z.object({ name: z.string(), confirmation: z.string() }).strict();
export const PATCH = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const input = schema.parse(await request.json());
  return renameRootWorkspace(actorId, (await params).id, input.name, input.confirmation);
});
