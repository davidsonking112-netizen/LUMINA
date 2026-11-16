import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.env.FORGE_DB_PATH ?? 'data/forge.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    request TEXT NOT NULL,
    generation_mode TEXT NOT NULL DEFAULT 'local_parser' CHECK (generation_mode IN ('local_parser', 'ai')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'in_progress', 'running', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    assistant_output_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    action_hash TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    request_id TEXT PRIMARY KEY,
    request_hash TEXT,
    plan_id TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS workspace_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source_plan_id TEXT NOT NULL REFERENCES plans(id),
    source_step_id TEXT NOT NULL,
    UNIQUE(source_plan_id, source_step_id)
  );
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source = 'owner'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL
  );
`)

const planColumns = db.pragma('table_info(plans)') as Array<{ name: string }>
if (!planColumns.some((column) => column.name === 'generation_mode')) {
  db.exec("ALTER TABLE plans ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'local_parser'")
}
if (!planColumns.some((column) => column.name === 'assistant_output_json')) {
  db.exec("ALTER TABLE plans ADD COLUMN assistant_output_json TEXT NOT NULL DEFAULT '{}'")
}

const idempotencyColumns = db.pragma('table_info(idempotency_keys)') as Array<{ name: string; notnull: number }>
const idempotencyForeignKeys = db.pragma('foreign_key_list(idempotency_keys)') as Array<{ table: string }>
if (!idempotencyColumns.some((column) => column.name === 'deleted_at')
  || idempotencyColumns.some((column) => ['request_hash', 'plan_id'].includes(column.name) && column.notnull)
  || idempotencyForeignKeys.length > 0) {
  const previousKeys = db.prepare('SELECT request_id, request_hash, plan_id, created_at FROM idempotency_keys').all() as Array<{ request_id: string; request_hash: string; plan_id: string; created_at: string }>
  db.transaction(() => {
    db.exec('ALTER TABLE idempotency_keys RENAME TO idempotency_keys_legacy')
    db.exec(`CREATE TABLE idempotency_keys (
      request_id TEXT PRIMARY KEY,
      request_hash TEXT,
      plan_id TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    )`)
    const hasPlan = db.prepare('SELECT id FROM plans WHERE id = ?')
    const insert = db.prepare('INSERT INTO idempotency_keys (request_id, request_hash, plan_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)')
    for (const key of previousKeys) {
      const planExists = Boolean(hasPlan.get(key.plan_id))
      insert.run(key.request_id, planExists ? key.request_hash : null, planExists ? key.plan_id : null, key.created_at, planExists ? null : new Date().toISOString())
    }
    db.exec('DROP TABLE idempotency_keys_legacy')
  })()
}

export function recordAudit(eventType: string, entityType: string, entityId: string, summary: string) {
  const id = crypto.randomUUID()
  const occurredAt = new Date().toISOString()
  db.prepare('INSERT INTO audit_events (id, occurred_at, event_type, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, occurredAt, eventType, entityType, entityId, summary)
  return { id, occurredAt, eventType, entityType, entityId, summary }
}
