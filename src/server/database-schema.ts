import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openResearchDatabase(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON;");
  createSchema(database);
  ensureCurrentAgentColumn(database);
  recoverInterruptedJobs(database);
  return database;
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      industry TEXT NOT NULL,
      question TEXT NOT NULL,
      depth TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      current_agent TEXT,
      reuse_kind TEXT,
      source_run_id TEXT,
      report_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (source_run_id) REFERENCES research_runs(id)
    );

    CREATE INDEX IF NOT EXISTS research_runs_fingerprint_index
    ON research_runs(fingerprint, status);

    CREATE TABLE IF NOT EXISTS queue_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS cache_entries (
      fingerprint TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS research_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research_batch_items (
      batch_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (batch_id, run_id),
      FOREIGN KEY (batch_id) REFERENCES research_batches(id),
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );
  `);
}

function ensureCurrentAgentColumn(database: DatabaseSync) {
  const columns = database.prepare(`
    PRAGMA table_info(research_runs)
  `).all() as unknown as Array<{ name: string }>;

  if (columns.some((column) => column.name === "current_agent")) {
    return;
  }

  database.exec("ALTER TABLE research_runs ADD COLUMN current_agent TEXT;");
}

function recoverInterruptedJobs(database: DatabaseSync) {
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE queue_jobs
    SET status = 'queued', locked_at = NULL, available_at = ?, updated_at = ?
    WHERE status = 'active'
  `).run(now, now);

  database.prepare(`
    UPDATE research_runs
    SET status = 'queued', current_agent = NULL, updated_at = ?
    WHERE status = 'running'
  `).run(now);
}
