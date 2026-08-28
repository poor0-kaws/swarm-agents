import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AgentUsage,
  ProviderResult,
  ResearchReport,
  ResearchRequest,
  ResearchRun,
  RunEvent,
  RunStatus,
} from "./domain.js";

interface RunRow {
  id: string;
  industry: string;
  question: string;
  depth: ResearchRun["depth"];
  fingerprint: string;
  status: RunStatus;
  reuse_kind: ResearchRun["reuseKind"];
  source_run_id: string | null;
  report_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EventRow {
  id: string;
  run_id: string;
  type: string;
  message: string;
  created_at: string;
}

interface UsageRow {
  id: string;
  run_id: string;
  agent_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}

export interface QueueJob {
  id: string;
  run_id: string;
  status: "queued" | "active" | "retrying" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
}

interface BatchRow {
  id: string;
  name: string;
  created_at: string;
}

export interface BatchSummary {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  runIds: string[];
  createdAt: string;
}

export class ResearchDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.createSchema();
    this.recoverInterruptedJobs();
  }

  close() {
    this.database.close();
  }

  createRun(request: ResearchRequest, fingerprint: string, now: string): ResearchRun {
    const run: ResearchRun = {
      id: randomUUID(),
      industry: request.industry,
      question: request.question,
      depth: request.depth,
      fingerprint,
      status: "queued",
      reuseKind: null,
      sourceRunId: null,
      report: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database.prepare(`
        INSERT INTO research_runs (
          id, industry, question, depth, fingerprint, status, reuse_kind,
          source_run_id, report_json, error, created_at, updated_at,
          started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.industry,
        run.question,
        run.depth,
        run.fingerprint,
        run.status,
        run.reuseKind,
        run.sourceRunId,
        null,
        run.error,
        run.createdAt,
        run.updatedAt,
        run.startedAt,
        run.completedAt,
      );

      this.database.prepare(`
        INSERT INTO queue_jobs (
          id, run_id, status, attempts, max_attempts, available_at,
          locked_at, created_at, updated_at
        ) VALUES (?, ?, 'queued', 0, 3, ?, NULL, ?, ?)
      `).run(randomUUID(), run.id, now, now, now);

      this.insertEvent(run.id, "run.queued", "Research run joined the central queue.", now);
      this.database.exec("COMMIT;");
      return run;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  findCachedRun(fingerprint: string, now: string): ResearchRun | null {
    const row = this.database.prepare(`
      SELECT research_runs.*
      FROM cache_entries
      JOIN research_runs ON research_runs.id = cache_entries.run_id
      WHERE cache_entries.fingerprint = ?
        AND cache_entries.expires_at > ?
        AND research_runs.status = 'completed'
    `).get(fingerprint, now) as unknown as RunRow | undefined;

    return row ? mapRun(row) : null;
  }

  findInflightRun(fingerprint: string): ResearchRun | null {
    const row = this.database.prepare(`
      SELECT * FROM research_runs
      WHERE fingerprint = ?
        AND status IN ('queued', 'running', 'retrying')
        AND reuse_kind IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `).get(fingerprint) as unknown as RunRow | undefined;

    return row ? mapRun(row) : null;
  }

  createReusedRun(
    request: ResearchRequest,
    fingerprint: string,
    source: ResearchRun,
    reuseKind: "cached" | "deduplicated",
    now: string,
  ): ResearchRun {
    const isCached = reuseKind === "cached";
    const run: ResearchRun = {
      id: randomUUID(),
      industry: request.industry,
      question: request.question,
      depth: request.depth,
      fingerprint,
      status: isCached ? "completed" : "queued",
      reuseKind,
      sourceRunId: source.id,
      report: isCached ? source.report : null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: isCached ? now : null,
      completedAt: isCached ? now : null,
    };

    this.database.prepare(`
      INSERT INTO research_runs (
        id, industry, question, depth, fingerprint, status, reuse_kind,
        source_run_id, report_json, error, created_at, updated_at,
        started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.industry,
      run.question,
      run.depth,
      run.fingerprint,
      run.status,
      run.reuseKind,
      run.sourceRunId,
      run.report ? JSON.stringify(run.report) : null,
      run.error,
      run.createdAt,
      run.updatedAt,
      run.startedAt,
      run.completedAt,
    );

    const eventType = isCached ? "run.cache-hit" : "run.deduplicated";
    const message = isCached
      ? "A fresh completed result was reused."
      : "This request joined identical research already in progress.";
    this.insertEvent(run.id, eventType, message, now);
    return run;
  }

  listRuns(limit = 25): ResearchRun[] {
    const rows = this.database.prepare(`
      SELECT * FROM research_runs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as unknown as RunRow[];

    return rows.map(mapRun);
  }

  getRun(runId: string): ResearchRun | null {
    const row = this.database.prepare(`
      SELECT * FROM research_runs WHERE id = ?
    `).get(runId) as unknown as RunRow | undefined;

    return row ? mapRun(row) : null;
  }

  getEvents(runId: string): RunEvent[] {
    const rows = this.database.prepare(`
      SELECT * FROM run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as unknown as EventRow[];

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  getUsageRecords(runId: string): AgentUsage[] {
    const rows = this.database.prepare(`
      SELECT * FROM usage_records
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as unknown as UsageRow[];

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      agentName: row.agent_name,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
      createdAt: row.created_at,
    }));
  }

  claimNextJob(now: string): QueueJob | null {
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const job = this.database.prepare(`
        SELECT id, run_id, status, attempts, max_attempts, available_at, locked_at
        FROM queue_jobs
        WHERE status IN ('queued', 'retrying') AND available_at <= ?
        ORDER BY available_at ASC, created_at ASC
        LIMIT 1
      `).get(now) as unknown as QueueJob | undefined;

      if (!job) {
        this.database.exec("COMMIT;");
        return null;
      }

      this.database.prepare(`
        UPDATE queue_jobs
        SET status = 'active', attempts = attempts + 1, locked_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, job.id);

      this.database.prepare(`
        UPDATE research_runs
        SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ?
      `).run(now, now, job.run_id);

      this.insertEvent(job.run_id, "run.started", "A worker started the research run.", now);
      this.database.exec("COMMIT;");

      return { ...job, status: "active", attempts: job.attempts + 1, locked_at: now };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordAgentResult(runId: string, agentName: string, result: ProviderResult, now: string) {
    this.database.prepare(`
      INSERT INTO usage_records (
        id, run_id, agent_name, model, input_tokens, output_tokens,
        estimated_cost_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      runId,
      agentName,
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.estimatedCostUsd,
      now,
    );

    this.insertEvent(
      runId,
      "agent.completed",
      `${agentName} completed its assignment.`,
      now,
    );
  }

  retryJob(
    jobId: string,
    runId: string,
    message: string,
    now: string,
    availableAt: string,
    nextAttempt: number,
    delayMs: number,
  ) {
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database.prepare(`
        UPDATE queue_jobs
        SET status = 'retrying', available_at = ?, locked_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(availableAt, now, jobId);

      this.database.prepare(`
        UPDATE research_runs
        SET status = 'retrying', error = ?, updated_at = ?
        WHERE id = ?
      `).run(message, now, runId);

      this.insertEvent(
        runId,
        "run.retrying",
        `Retry ${nextAttempt} scheduled in ${delayMs}ms.`,
        now,
      );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getQueueStats() {
    const rows = this.database.prepare(`
      SELECT status, COUNT(*) AS count
      FROM queue_jobs
      GROUP BY status
    `).all() as unknown as Array<{ status: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.status, row.count]));

    return {
      queued: counts.get("queued") ?? 0,
      active: counts.get("active") ?? 0,
      retrying: counts.get("retrying") ?? 0,
      completed: counts.get("completed") ?? 0,
      failed: counts.get("failed") ?? 0,
    };
  }

  createBatch(name: string, runIds: string[], now: string): BatchSummary {
    const batchId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database.prepare(`
        INSERT INTO research_batches (id, name, created_at)
        VALUES (?, ?, ?)
      `).run(batchId, name, now);

      const insertItem = this.database.prepare(`
        INSERT INTO research_batch_items (batch_id, run_id, position)
        VALUES (?, ?, ?)
      `);
      runIds.forEach((runId, position) => insertItem.run(batchId, runId, position));
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }

    return {
      id: batchId,
      name,
      status: "queued",
      total: runIds.length,
      completed: 0,
      failed: 0,
      runIds,
      createdAt: now,
    };
  }

  getBatch(batchId: string): BatchSummary | null {
    const batch = this.database.prepare(`
      SELECT * FROM research_batches WHERE id = ?
    `).get(batchId) as unknown as BatchRow | undefined;

    if (!batch) {
      return null;
    }

    const runs = this.database.prepare(`
      SELECT research_runs.id, research_runs.status
      FROM research_batch_items
      JOIN research_runs ON research_runs.id = research_batch_items.run_id
      WHERE research_batch_items.batch_id = ?
      ORDER BY research_batch_items.position ASC
    `).all(batchId) as unknown as Array<{ id: string; status: RunStatus }>;
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const active = runs.some((run) => run.status === "running" || run.status === "retrying");
    const finished = completed + failed === runs.length;

    let status: BatchSummary["status"] = "queued";
    if (finished) {
      status = failed > 0 ? "failed" : "completed";
    } else if (active || completed > 0 || failed > 0) {
      status = "running";
    }

    return {
      id: batch.id,
      name: batch.name,
      status,
      total: runs.length,
      completed,
      failed,
      runIds: runs.map((run) => run.id),
      createdAt: batch.created_at,
    };
  }

  completeJob(
    jobId: string,
    runId: string,
    report: ResearchReport,
    now: string,
    cacheExpiresAt: string,
  ) {
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database.prepare(`
        UPDATE queue_jobs
        SET status = 'completed', locked_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, jobId);

      this.database.prepare(`
        UPDATE research_runs
        SET status = 'completed', report_json = ?, error = NULL,
            updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(JSON.stringify(report), now, now, runId);

      this.database.prepare(`
        INSERT INTO cache_entries (fingerprint, run_id, expires_at, created_at)
        SELECT fingerprint, id, ?, ? FROM research_runs WHERE id = ?
        ON CONFLICT(fingerprint) DO UPDATE SET
          run_id = excluded.run_id,
          expires_at = excluded.expires_at,
          created_at = excluded.created_at
      `).run(cacheExpiresAt, now, runId);

      this.insertEvent(runId, "run.completed", "Research report is ready.", now);
      this.completeFollowers(runId, report, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  failJob(jobId: string, runId: string, message: string, now: string) {
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database.prepare(`
        UPDATE queue_jobs
        SET status = 'failed', locked_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, jobId);

      this.database.prepare(`
        UPDATE research_runs
        SET status = 'failed', error = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(message, now, now, runId);

      this.insertEvent(runId, "run.failed", message, now);
      this.failFollowers(runId, message, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY,
        industry TEXT NOT NULL,
        question TEXT NOT NULL,
        depth TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
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

  private recoverInterruptedJobs() {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE queue_jobs
      SET status = 'queued', locked_at = NULL, available_at = ?, updated_at = ?
      WHERE status = 'active'
    `).run(now, now);

    this.database.prepare(`
      UPDATE research_runs
      SET status = 'queued', updated_at = ?
      WHERE status = 'running'
    `).run(now);
  }

  private insertEvent(runId: string, type: string, message: string, now: string) {
    this.database.prepare(`
      INSERT INTO run_events (id, run_id, type, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), runId, type, message, now);
  }

  private completeFollowers(runId: string, report: ResearchReport, now: string) {
    const followers = this.database.prepare(`
      SELECT id FROM research_runs
      WHERE source_run_id = ? AND reuse_kind = 'deduplicated'
        AND status NOT IN ('completed', 'failed')
    `).all(runId) as unknown as Array<{ id: string }>;

    for (const follower of followers) {
      this.database.prepare(`
        UPDATE research_runs
        SET status = 'completed', report_json = ?, error = NULL,
            started_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(report), now, now, now, follower.id);
      this.insertEvent(
        follower.id,
        "run.completed",
        "The original research finished, so this joined request is ready.",
        now,
      );
    }
  }

  private failFollowers(runId: string, message: string, now: string) {
    const followers = this.database.prepare(`
      SELECT id FROM research_runs
      WHERE source_run_id = ? AND reuse_kind = 'deduplicated'
        AND status NOT IN ('completed', 'failed')
    `).all(runId) as unknown as Array<{ id: string }>;

    for (const follower of followers) {
      this.database.prepare(`
        UPDATE research_runs
        SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(message, now, now, follower.id);
      this.insertEvent(follower.id, "run.failed", message, now);
    }
  }
}

function mapRun(row: RunRow): ResearchRun {
  return {
    id: row.id,
    industry: row.industry,
    question: row.question,
    depth: row.depth,
    fingerprint: row.fingerprint,
    status: row.status,
    reuseKind: row.reuse_kind,
    sourceRunId: row.source_run_id,
    report: row.report_json ? JSON.parse(row.report_json) as ResearchReport : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
