import { afterEach, describe, expect, test } from "vitest";

import { createServer, type ResearchServer } from "../src/server/app.js";
import type { ResearchProvider } from "../src/server/domain.js";
import { SimulatedResearchProvider } from "../src/server/providers/simulated-provider.js";

const servers: ResearchServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("research runs", () => {
  test("a researcher can submit a question and receive a completed report with usage", async () => {
    const server = await createServer({
      databasePath: ":memory:",
      provider: new SimulatedResearchProvider({ delayMs: 1 }),
      worker: { concurrency: 1, pollIntervalMs: 2 },
    });
    servers.push(server);

    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        industry: "Semiconductor equipment",
        question: "Where is pricing power strongest?",
        depth: "standard",
      },
    });

    expect(createResponse.statusCode).toBe(202);
    const created = createResponse.json<{ id: string; status: string }>();
    expect(created.status).toBe("queued");

    const completed = await waitForCompletedRun(server, created.id);

    expect(completed.status).toBe("completed");
    expect(completed.report.executiveSummary).toContain("Semiconductor equipment");
    expect(completed.report.findings).toHaveLength(5);
    expect(completed.usage.requests).toBe(7);
    expect(completed.usage.inputTokens).toBeGreaterThan(0);
    expect(completed.events.map((event: { type: string }) => event.type)).toContain("run.completed");
  });

  test("an identical in-flight request joins the original work", async () => {
    const provider = new CountingProvider(10);
    const server = await createServer({
      databasePath: ":memory:",
      provider,
      worker: { concurrency: 1, pollIntervalMs: 2 },
    });
    servers.push(server);

    const request = {
      industry: "Grid storage",
      question: "Which parts of the value chain have durable margins?",
      depth: "standard",
    };
    const originalResponse = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: request,
    });
    const duplicateResponse = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: request,
    });

    const original = originalResponse.json<{ id: string }>();
    const duplicate = duplicateResponse.json<{
      id: string;
      reuseKind: string;
      sourceRunId: string;
    }>();

    expect(duplicate.reuseKind).toBe("deduplicated");
    expect(duplicate.sourceRunId).toBe(original.id);

    await waitForCompletedRun(server, original.id);
    const completedDuplicate = await waitForCompletedRun(server, duplicate.id);

    expect(completedDuplicate.report.executiveSummary).toContain("Grid storage");
    expect(provider.calls).toBe(7);
  });

  test("an identical completed request is served from the result cache", async () => {
    const provider = new CountingProvider(1);
    const server = await createServer({
      databasePath: ":memory:",
      provider,
      worker: { concurrency: 1, pollIntervalMs: 2 },
      cacheTtlMs: 60_000,
    });
    servers.push(server);

    const request = {
      industry: "Industrial robotics",
      question: "What creates recurring revenue for suppliers?",
      depth: "deep",
    };
    const firstResponse = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: request,
    });
    const first = firstResponse.json<{ id: string }>();
    await waitForCompletedRun(server, first.id);

    const cachedResponse = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: request,
    });
    const cached = cachedResponse.json<{
      id: string;
      status: string;
      reuseKind: string;
      sourceRunId: string;
    }>();

    expect(cached.status).toBe("completed");
    expect(cached.reuseKind).toBe("cached");
    expect(cached.sourceRunId).toBe(first.id);
    expect(provider.calls).toBe(7);
  });

  test("retryable failures wait longer after each attempt and eventually complete", async () => {
    const provider = new FlakyProvider(2);
    const server = await createServer({
      databasePath: ":memory:",
      provider,
      worker: {
        concurrency: 1,
        pollIntervalMs: 1,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 50,
      },
    });
    servers.push(server);

    const response = await server.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        industry: "Specialty insurance",
        question: "Where are underwriting margins most defensible?",
        depth: "quick",
      },
    });
    const run = response.json<{ id: string }>();
    const completed = await waitForCompletedRun(server, run.id);

    const retryMessages = completed.events
      .filter((event: { type: string }) => event.type === "run.retrying")
      .map((event: { message: string }) => event.message);

    expect(retryMessages).toEqual([
      "Retry 2 scheduled in 5ms.",
      "Retry 3 scheduled in 10ms.",
    ]);
    expect(completed.usage.requests).toBe(7);
  });

  test("the worker pool never exceeds its concurrency limit", async () => {
    const provider = new ConcurrencyTrackingProvider(8);
    const server = await createServer({
      databasePath: ":memory:",
      provider,
      worker: { concurrency: 2, pollIntervalMs: 1 },
    });
    servers.push(server);

    const runIds = await Promise.all([
      createRun(server, "Water utilities"),
      createRun(server, "Marine logistics"),
      createRun(server, "Medical diagnostics"),
    ]);
    await Promise.all(runIds.map((runId) => waitForCompletedRun(server, runId)));

    expect(provider.maximumActiveCalls).toBe(2);

    const queueResponse = await server.app.inject({
      method: "GET",
      url: "/api/queue",
    });
    expect(queueResponse.json()).toMatchObject({
      queued: 0,
      active: 0,
      retrying: 0,
      completed: 3,
      failed: 0,
      concurrency: 2,
    });
  });

  test("a historical batch creates normal research runs and reports progress", async () => {
    const server = await createServer({
      databasePath: ":memory:",
      provider: new SimulatedResearchProvider({ delayMs: 1 }),
      worker: { concurrency: 2, pollIntervalMs: 1 },
    });
    servers.push(server);

    const response = await server.app.inject({
      method: "POST",
      url: "/api/batches",
      payload: {
        name: "Lithium cycle review",
        items: [
          {
            industry: "Lithium mining",
            question: "What changed in industry economics during 2024?",
            depth: "quick",
          },
          {
            industry: "Lithium mining",
            question: "What changed in industry economics during 2025?",
            depth: "quick",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const batch = response.json<{ id: string; runIds: string[] }>();
    expect(batch.runIds).toHaveLength(2);

    await Promise.all(batch.runIds.map((runId) => waitForCompletedRun(server, runId)));
    const completedResponse = await server.app.inject({
      method: "GET",
      url: `/api/batches/${batch.id}`,
    });

    expect(completedResponse.json()).toMatchObject({
      name: "Lithium cycle review",
      total: 2,
      completed: 2,
      failed: 0,
      status: "completed",
    });
  });
});

class CountingProvider implements ResearchProvider {
  readonly version = "counting-v1";
  readonly delegate: SimulatedResearchProvider;
  calls = 0;

  constructor(delayMs: number) {
    this.delegate = new SimulatedResearchProvider({ delayMs });
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    this.calls += 1;
    return this.delegate.runAgent(input);
  }
}

class FlakyProvider implements ResearchProvider {
  readonly version = "flaky-v1";
  readonly delegate = new SimulatedResearchProvider({ delayMs: 1 });
  private failuresRemaining: number;

  constructor(failureCount: number) {
    this.failuresRemaining = failureCount;
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      const { RetryableProviderError } = await import("../src/server/domain.js");
      throw new RetryableProviderError("Provider is temporarily unavailable.");
    }

    return this.delegate.runAgent(input);
  }
}

class ConcurrencyTrackingProvider implements ResearchProvider {
  readonly version = "concurrency-v1";
  readonly delegate: SimulatedResearchProvider;
  activeCalls = 0;
  maximumActiveCalls = 0;

  constructor(delayMs: number) {
    this.delegate = new SimulatedResearchProvider({ delayMs });
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    this.activeCalls += 1;
    this.maximumActiveCalls = Math.max(this.maximumActiveCalls, this.activeCalls);

    try {
      return await this.delegate.runAgent(input);
    } finally {
      this.activeCalls -= 1;
    }
  }
}

async function createRun(server: ResearchServer, industry: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/runs",
    payload: {
      industry,
      question: `What are the strongest economics in ${industry}?`,
      depth: "quick",
    },
  });

  return response.json<{ id: string }>().id;
}

async function waitForCompletedRun(server: ResearchServer, runId: string) {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const response = await server.app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
    });
    const run = response.json<any>();

    if (run.status === "completed") {
      return run;
    }

    if (run.status === "failed") {
      throw new Error(`Research run failed: ${run.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Research run did not finish before the test timeout.");
}
