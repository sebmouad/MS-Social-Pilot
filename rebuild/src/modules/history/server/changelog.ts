import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfigBatch } from '@/server/config/store';
import { prisma } from '@/server/data';
import { assertRootActor, lockRootActor } from '@/server/root/legacy/authz';
import { writeRootAudit } from '@/server/root/legacy/audit';
import { rootResultLimit, rootTransaction } from '@/server/root/legacy/policy';

/**
 * The public changelog ("What's new"). Anyone may read it when the public site is on; only the installation owner
 * (Root) writes it, through this one service behind the Root screen, the REST routes and the MCP tools.
 */
export type ChangelogEntry = { id: string; publishedOn: string; title: string; body: string };
type Row = { id: string; publishedOn: Date; title: string; body: string };
const shape = (row: Row): ChangelogEntry => ({ id: row.id, publishedOn: row.publishedOn.toISOString().slice(0, 10), title: row.title, body: row.body });

const limits = async () => {
  const values = await runtimeConfigBatch(['public.changelogPageSize', 'public.changelogTitleMaxCharacters', 'public.changelogBodyMaxCharacters', 'root.confirmationMaxCharacters', 'root.identifierMaxCharacters']);
  return { pageSize: values['public.changelogPageSize'] as number, title: values['public.changelogTitleMaxCharacters'] as number, body: values['public.changelogBodyMaxCharacters'] as number, confirmation: values['root.confirmationMaxCharacters'] as number, identifier: values['root.identifierMaxCharacters'] as number };
};

async function readEntries(size: number): Promise<ChangelogEntry[]> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT id, "publishedOn", title, body FROM changelog_entries ORDER BY "publishedOn" DESC, "createdAt" DESC, id DESC LIMIT ${size}`;
  return rows.map(shape);
}

/** Public read: newest first, bounded by the Root page size. */
export async function listPublicChangelog(): Promise<ChangelogEntry[]> {
  return readEntries((await limits()).pageSize);
}

/** Root read: the same list, optionally narrowed by a smaller MCP result ceiling. */
export async function listRootChangelog(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const { pageSize } = await limits();
  const size = rootResultLimit(pageSize, resultCap);
  return { items: await readEntries(size), pageSize: size };
}

export const addChangelogConfirmation = (title: string) => `ADD CHANGELOG ENTRY ${title.trim()}`;
export const removeChangelogConfirmation = (id: string) => `REMOVE CHANGELOG ENTRY ${id}`;

/** Add one entry. The exact confirmation, the Root actor re-check and the audit row share one transaction. */
export async function addRootChangelogEntry(actorId: string, input: unknown) {
  const max = await limits();
  const parsed = z.object({
    publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)),
    title: z.string().trim().min(1).max(max.title),
    body: z.string().trim().max(max.body).default(''),
    confirmation: z.string().max(max.confirmation),
  }).strict().safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Enter a date, a title and the exact confirmation.');
  const { publishedOn, title, body, confirmation } = parsed.data;
  if (confirmation !== addChangelogConfirmation(title)) throw new OperationError('invalid_request', `Enter the exact confirmation: ${addChangelogConfirmation(title)}`);
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId);
    const id = randomUUID();
    const inserted = await tx.$executeRaw`INSERT INTO changelog_entries (id, "publishedOn", title, body, "createdAt") VALUES (${id}, ${publishedOn}::date, ${title}, ${body}, NOW())`;
    if (inserted !== 1) throw new OperationError('unavailable', 'The entry could not be saved.');
    await writeRootAudit(tx, actorId, 'changelog.added', { id, title });
    return { entry: { id, publishedOn, title, body } satisfies ChangelogEntry };
  });
}

/** Remove one entry (a removal is permanent, so it needs the exact confirmation). */
export async function removeRootChangelogEntry(actorId: string, id: unknown, confirmation: unknown) {
  const max = await limits();
  if (typeof id !== 'string' || !id || id.length > max.identifier) throw new OperationError('invalid_request', 'Choose an entry.');
  if (typeof confirmation !== 'string' || confirmation.length > max.confirmation || confirmation !== removeChangelogConfirmation(id)) {
    throw new OperationError('invalid_request', `Enter the exact confirmation: ${removeChangelogConfirmation(id)}`);
  }
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId);
    const removed = await tx.$executeRaw`DELETE FROM changelog_entries WHERE id = ${id}`;
    if (removed === 0) throw new OperationError('not_found', 'Entry not found.');
    await writeRootAudit(tx, actorId, 'changelog.removed', { id });
    return { removed: true, id };
  });
}
