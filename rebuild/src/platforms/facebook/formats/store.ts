import {
  FacebookAttemptStoreUnavailableError, type FacebookNativeAttemptRecord, type FacebookNativeAttemptStore, type FacebookSqlPort,
} from './types';

/**
 * PROPOSED migration (not applied; lead to review and place in the migration set):
 *
 *   CREATE TABLE IF NOT EXISTS facebook_native_attempts (
 *     operation_id text PRIMARY KEY,
 *     format       text NOT NULL,
 *     state        text NOT NULL CHECK (state IN ('started','published','rejected','uncertain','confirmed','deleted')),
 *     known_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
 *     steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
 *     target_id    text,
 *     remote_id    text,
 *     created_at   timestamptz NOT NULL DEFAULT now(),
 *     updated_at   timestamptz NOT NULL DEFAULT now()
 *   );
 *
 * The caller must make operation_id unique per workspace (e.g. prefix the workspace id).
 */
const TABLE = 'facebook_native_attempts';

function toRecord(row: Record<string, unknown>): FacebookNativeAttemptRecord {
  const ids = Array.isArray(row.known_ids) ? row.known_ids.filter((x): x is string => typeof x === 'string') : [];
  return {
    operationId: String(row.operation_id), format: row.format as FacebookNativeAttemptRecord['format'],
    state: row.state as FacebookNativeAttemptRecord['state'], knownIds: ids,
    steps: Array.isArray(row.steps) ? row.steps as FacebookNativeAttemptRecord['steps'] : [],
    targetId: typeof row.target_id === 'string' ? row.target_id : undefined,
    remoteId: typeof row.remote_id === 'string' ? row.remote_id : null,
  };
}

/**
 * Postgres-backed attempt store. All SQL is parameterized. Any database failure
 * surfaces as FacebookAttemptStoreUnavailableError so callers fail closed
 * (begin) or leave the row in its last durable state (update).
 */
export function createPostgresAttemptStore(db: FacebookSqlPort): FacebookNativeAttemptStore {
  async function run(sql: string, params: readonly unknown[]) {
    try { return await db.query(sql, params); } catch { throw new FacebookAttemptStoreUnavailableError(); }
  }
  return {
    async begin(r) {
      const ins = await run(
        `INSERT INTO ${TABLE} (operation_id, format, state, known_ids, target_id) VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`,
        [r.operationId, r.format, r.state, JSON.stringify(r.knownIds), r.targetId ?? null]);
      if (ins.rows.length) return { created: true as const };
      const existing = await this.get(r.operationId);
      if (!existing) throw new FacebookAttemptStoreUnavailableError();
      return { created: false as const, existing };
    },
    async update(id, patch, expectedStates) {
      const r = await run(
        `UPDATE ${TABLE} SET state = COALESCE($2, state), known_ids = COALESCE($3::jsonb, known_ids),
           remote_id = COALESCE($4, remote_id), steps = COALESCE($6::jsonb, steps), updated_at = now()
         WHERE operation_id = $1 AND state <> 'deleted' AND ($5::text[] IS NULL OR state = ANY($5::text[]))
         RETURNING operation_id`, // deleted is terminal; expectedStates makes the write a compare-and-set
        [id, patch.state ?? null, patch.knownIds ? JSON.stringify(patch.knownIds) : null, patch.remoteId ?? null, expectedStates ? [...expectedStates] : null, patch.steps ? JSON.stringify(patch.steps) : null]);
      return r.rows.length > 0;
    },
    async get(id) {
      const r = await run(`SELECT operation_id, format, state, known_ids, target_id, remote_id, steps FROM ${TABLE} WHERE operation_id = $1`, [id]);
      return r.rows[0] ? toRecord(r.rows[0]) : null;
    },
  };
}
