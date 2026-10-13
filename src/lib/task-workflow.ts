export interface WorkflowRow {
  title: string; dueOn: string | null; assigneeId: string | null;
  state: 'created' | 'failed' | 'unattempted' | 'uncertain';
}
export function makeWorkflow(text: string, start: string, gap: number, assignee: string): WorkflowRow[] {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 30) throw new Error('rows');
  if (lines.some(line => line.length > 200)) throw new Error('title');
  return lines.map((title, index) => ({ title, assigneeId: assignee || null, state: 'unattempted',
    dueOn: start ? new Date(Date.parse(`${start}T00:00:00Z`) + index * gap * 86_400_000).toISOString().slice(0, 10) : null,
  }));
}
export async function runWorkflow(rows: WorkflowRow[], send: (row: WorkflowRow) => Promise<boolean | 'uncertain'>, update?: (rows: WorkflowRow[]) => void): Promise<WorkflowRow[]> {
  const result = rows.map(row => ({ ...row }));
  for (const row of result) {
    if (row.state === 'created' || row.state === 'uncertain') continue;
    const outcome = await send(row);
    row.state = outcome === 'uncertain' ? 'uncertain' : outcome ? 'created' : 'failed';
    update?.(result.map(entry => ({ ...entry })));
    if (row.state === 'failed' || row.state === 'uncertain') break;
  }
  return result;
}
