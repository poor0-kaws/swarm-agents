import { createHash } from "node:crypto";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { researchAgents } from "./agents.js";
import { ResearchDatabase } from "./database.js";
import type { ResearchProvider, UsageSummary } from "./domain.js";
import { ResearchOrchestrator } from "./orchestrator.js";
import { WorkerPool } from "./worker-pool.js";

interface CreateServerOptions {
  databasePath: string;
  provider: ResearchProvider;
  cacheTtlMs?: number;
  staticDirectory?: string;
  worker?: {
    concurrency?: number;
    pollIntervalMs?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
  };
  now?: () => Date;
}

export interface ResearchServer {
  app: FastifyInstance;
  close(): Promise<void>;
}

const createRunSchema = z.object({
  industry: z.string().trim().min(2).max(120),
  question: z.string().trim().min(8).max(1_000),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

const createBatchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  items: z.array(createRunSchema).min(1).max(100),
});

export async function createServer(options: CreateServerOptions): Promise<ResearchServer> {
  const now = options.now ?? (() => new Date());
  const database = new ResearchDatabase(options.databasePath);
  const orchestrator = new ResearchOrchestrator(database, options.provider, now);
  const workerPool = new WorkerPool(database, orchestrator, {
    concurrency: options.worker?.concurrency ?? 2,
    pollIntervalMs: options.worker?.pollIntervalMs ?? 100,
    cacheTtlMs: options.cacheTtlMs ?? 60 * 60 * 1000,
    retryBaseDelayMs: options.worker?.retryBaseDelayMs ?? 1_000,
    retryMaxDelayMs: options.worker?.retryMaxDelayMs ?? 30_000,
    now,
  });
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  if (options.staticDirectory) {
    await app.register(fastifyStatic, {
      root: options.staticDirectory,
    });
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/queue", async () => ({
    ...database.getQueueStats(),
    concurrency: options.worker?.concurrency ?? 2,
  }));

  app.get("/api/runs", async () => {
    return database.listRuns().map((run) => ({
      ...run,
      usage: summarizeUsage(database.getUsageRecords(run.id)),
    }));
  });

  app.post("/api/runs", async (request, reply) => {
    const parsed = createRunSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Please check the research request.",
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const result = submitRun(parsed.data);
    return reply.status(result.statusCode).send(result.run);
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request, reply) => {
    const run = database.getRun(request.params.runId);

    if (!run) {
      return reply.status(404).send({ error: "Research run was not found." });
    }

    const usageRecords = database.getUsageRecords(run.id);
    return {
      ...run,
      events: database.getEvents(run.id),
      usage: summarizeUsage(usageRecords),
      usageRecords,
      agents: researchAgents.map((agent) => ({
        name: agent.name,
        purpose: agent.purpose,
      })),
    };
  });

  app.post("/api/batches", async (request, reply) => {
    const parsed = createBatchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Please check the historical batch.",
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const runIds = parsed.data.items.map((item) => submitRun(item).run.id);
    const batch = database.createBatch(parsed.data.name, runIds, now().toISOString());
    return reply.status(202).send(batch);
  });

  app.get<{ Params: { batchId: string } }>("/api/batches/:batchId", async (request, reply) => {
    const batch = database.getBatch(request.params.batchId);

    if (!batch) {
      return reply.status(404).send({ error: "Research batch was not found." });
    }

    return batch;
  });

  function submitRun(input: z.infer<typeof createRunSchema>) {
    const fingerprint = createFingerprint(input, options.provider.version);
    const timestamp = now().toISOString();
    const cachedRun = database.findCachedRun(fingerprint, timestamp);

    if (cachedRun) {
      return {
        run: database.createReusedRun(input, fingerprint, cachedRun, "cached", timestamp),
        statusCode: 200 as const,
      };
    }

    const inflightRun = database.findInflightRun(fingerprint);
    if (inflightRun) {
      return {
        run: database.createReusedRun(input, fingerprint, inflightRun, "deduplicated", timestamp),
        statusCode: 202 as const,
      };
    }

    return {
      run: database.createRun(input, fingerprint, timestamp),
      statusCode: 202 as const,
    };
  }

  await app.ready();
  workerPool.start();

  return {
    app,
    async close() {
      await workerPool.stop();
      await app.close();
      database.close();
    },
  };
}

function createFingerprint(
  request: z.infer<typeof createRunSchema>,
  providerVersion: string,
) {
  const normalized = [
    request.industry.trim().toLowerCase(),
    request.question.trim().toLowerCase(),
    request.depth,
    providerVersion,
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex");
}

function summarizeUsage(records: Array<{
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}>): UsageSummary {
  return records.reduce<UsageSummary>((summary, record) => ({
    requests: summary.requests + 1,
    inputTokens: summary.inputTokens + record.inputTokens,
    outputTokens: summary.outputTokens + record.outputTokens,
    estimatedCostUsd: Number((summary.estimatedCostUsd + record.estimatedCostUsd).toFixed(6)),
  }), {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  });
}
