import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS, listSchema, reportConfirmation, templateActionSchema, type ReportActor, type ReportTemplateView, type ReportSectionId } from '../contracts';
import { audit, authorizeReport, bad, isUnique, lockActor, missing, pageOf, requireWorkspaceWide } from './access';
import { reportLimits, transact } from './limits';
import { recapOffered } from './recap';

type Row = { id: string; name: string; sections: unknown; rangeKey: string; createdAt: Date; scheduleCount: bigint | number };
/** Stored choices are kept as they are, including ones the shared readers cannot yet supply; unknown ids are dropped. */
export const cleanSections = (value: unknown): ReportSectionId[] => (Array.isArray(value) ? value : []).filter((s): s is ReportSectionId => (REPORT_SECTION_IDS as readonly string[]).includes(s as string));
const supportedIn = (section: string) => (REPORT_SUPPORTED_SECTIONS as readonly string[]).includes(section);

export async function listReportTemplates(actor: ReportActor, input: unknown = {}) {
  const parsed = listSchema.safeParse(input ?? {}); if (!parsed.success) throw bad('Choose a valid result page.');
  const auth = await authorizeReport(actor, 'read');
  requireWorkspaceWide(actor);
  const limits = await reportLimits();
  const size = pageOf(limits.pageSize, auth.maxItems);
  const offset = (parsed.data.page - 1) * size;
  // Schedule counts include only schedules on channels this person may see.
  const scope = auth.scope;
  const rows = await prisma.$queryRaw<Row[]>`SELECT t.id, t.name, t.sections, t."rangeKey", t."createdAt", (SELECT COUNT(*) FROM report_schedules s WHERE s."templateId" = t.id AND s."workspaceId" = t."workspaceId" AND (${scope === null}::boolean OR s."targetId" = ANY(${[...(scope ?? [])]}::text[]))) AS "scheduleCount" FROM report_templates t WHERE t."workspaceId" = ${actor.workspaceId} ORDER BY t.name ASC, t.id ASC OFFSET ${offset} LIMIT ${size + 1}`;
  const templates: ReportTemplateView[] = rows.slice(0, size).map(r => ({ id: r.id, name: r.name, sections: cleanSections(r.sections), rangeKey: r.rangeKey as ReportTemplateView['rangeKey'], createdAt: r.createdAt, scheduleCount: Number(r.scheduleCount) }));
  // `sections` is every stored identifier (unchanged); `selectableSections` is what a new choice may include today.
  return { ok: true as const, templates, page: parsed.data.page, hasMore: rows.length > size, sections: REPORT_SECTION_IDS, selectableSections: (await recapOffered(actor)) ? REPORT_SUPPORTED_SECTIONS : REPORT_SUPPORTED_SECTIONS.filter(s => s !== 'aiRecap'), canManage: auth.canManage };
}

export async function manageReportTemplate(actor: ReportActor, input: unknown) {
  const parsed = templateActionSchema.safeParse(input); if (!parsed.success) throw bad();
  const value = parsed.data;
  const expected = value.action === 'create' ? reportConfirmation.createTemplate(value.name) : value.action === 'update' ? reportConfirmation.updateTemplate(value.id) : reportConfirmation.deleteTemplate(value.id);
  if (value.confirmation !== expected) throw bad();
  await authorizeReport(actor, 'write', { manager: true });
  requireWorkspaceWide(actor);
  const limits = await reportLimits();
  if (value.action !== 'delete' && [...value.name].length > limits.nameMax) throw bad(`Use a name of ${limits.nameMax} characters or fewer.`);
  const aiOk = value.action !== 'delete' && value.sections.includes('aiRecap') ? await recapOffered(actor) : true;
  const supported = (section: string) => supportedIn(section) && (section !== 'aiRecap' || aiOk);
  const unsupportedNew = (list: readonly ReportSectionId[], stored: readonly string[] = []) => list.filter(s => !supported(s) && !stored.includes(s));
  if (value.action === 'create' && unsupportedNew(value.sections).length) throw bad('Choose only report sections that are available.');
  try {
    return await transact(actor.workspaceId, limits, async tx => {
      await lockActor(tx, actor);
      if (value.action === 'create') {
        const count = Number((await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM report_templates WHERE "workspaceId" = ${actor.workspaceId}`)[0]?.count ?? 0);
        if (count >= limits.maxTemplates) throw new OperationError('conflict', 'This workspace has reached its report template limit. Delete one first.');
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO report_templates (id, "workspaceId", name, sections, "rangeKey", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${value.name}, ${JSON.stringify(value.sections)}::jsonb, ${value.rangeKey}, NOW())`;
        await audit(tx, actor, 'analytics.report_template_created', { templateId: id, sections: value.sections.length, rangeKey: value.rangeKey });
        return { ok: true as const, action: value.action, id };
      }
      const found = await tx.$queryRaw<Array<{ id: string; sections: unknown }>>`SELECT id, sections FROM report_templates WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!found.length) throw missing();
      if (value.action === 'update') {
        // A legacy template keeps the choices it already stores; nothing new unsupported can be added.
        if (unsupportedNew(value.sections, cleanSections(found[0]!.sections)).length) throw bad('Choose only report sections that are available.');
        const changed = await tx.$executeRaw`UPDATE report_templates SET name = ${value.name}, sections = ${JSON.stringify(value.sections)}::jsonb, "rangeKey" = ${value.rangeKey} WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
        if (!changed) throw missing();
        await audit(tx, actor, 'analytics.report_template_updated', { templateId: value.id, sections: value.sections.length, rangeKey: value.rangeKey });
        return { ok: true as const, action: value.action, id: value.id };
      }
      const detached = await tx.$executeRaw`UPDATE report_schedules SET "templateId" = NULL WHERE "templateId" = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      const removed = await tx.$executeRaw`DELETE FROM report_templates WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (!removed) throw missing();
      await audit(tx, actor, 'analytics.report_template_deleted', { templateId: value.id, detachedSchedules: Number(detached) });
      return { ok: true as const, action: value.action, id: value.id, detachedSchedules: Number(detached) };
    });
  } catch (error) {
    if (isUnique(error)) throw new OperationError('conflict', 'A report template with this name already exists.');
    throw error;
  }
}
