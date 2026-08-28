import "dotenv/config";

import { resolve } from "node:path";

import { createServer } from "./app.js";
import type { ResearchProvider } from "./domain.js";
import { GroqResearchProvider } from "./providers/groq-provider.js";
import { SimulatedResearchProvider } from "./providers/simulated-provider.js";

const port = readNumber("API_PORT", 4100);
const host = process.env.API_HOST ?? "127.0.0.1";
const provider = createProvider();
const server = await createServer({
  databasePath: process.env.DATABASE_PATH ?? resolve("data/research-swarm.sqlite"),
  provider,
  cacheTtlMs: readNumber("CACHE_TTL_MS", 60 * 60 * 1000),
  worker: {
    concurrency: readNumber("WORKER_CONCURRENCY", 2),
    pollIntervalMs: readNumber("QUEUE_POLL_INTERVAL_MS", 250),
    retryBaseDelayMs: readNumber("RETRY_BASE_DELAY_MS", 1_000),
    retryMaxDelayMs: readNumber("RETRY_MAX_DELAY_MS", 30_000),
  },
});

await server.app.listen({ host, port });
console.log(`Research API listening at http://${host}:${port}`);
console.log(`Provider: ${provider.version}`);

const stop = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function createProvider(): ResearchProvider {
  if (process.env.RESEARCH_PROVIDER !== "groq") {
    return new SimulatedResearchProvider();
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required when RESEARCH_PROVIDER=groq.");
  }

  return new GroqResearchProvider({
    apiKey,
    model: process.env.GROQ_MODEL,
    inputCostPerMillion: readNumber("GROQ_INPUT_COST_PER_MILLION", 0),
    outputCostPerMillion: readNumber("GROQ_OUTPUT_COST_PER_MILLION", 0),
  });
}

function readNumber(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number.`);
  }

  return number;
}
