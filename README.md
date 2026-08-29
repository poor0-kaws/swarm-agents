# Examen

Examen is a small financial-industry research system. You give it one question. It breaks the work into seven focused assignments, runs them through a central queue, and shows the result in a React dashboard.

The application is research software. It does not place trades and should not be treated as personalized investment advice.

## What is included

- A durable SQLite request queue
- Configurable worker concurrency
- Exponential retry delays for temporary provider failures
- Completed-result caching
- In-flight request deduplication
- Historical batches with one normal run per question
- Per-agent and per-run token usage
- A simulated provider that works without credentials
- A Groq Compound provider with built-in web and calculation tools
- A responsive React dashboard

## How the pieces fit together

Think of the system as a small research office:

1. The API is the front desk. It accepts a research question immediately.
2. SQLite is the office notebook. It remembers every run, event, usage record, and queued job.
3. The worker pool is the team manager. It allows only a fixed number of jobs to work at the same time.
4. The orchestrator gives one assignment at a time to seven specialized agents.
5. The provider is the research engine. It can be the included simulator or Groq.
6. The React dashboard shows what the office is doing and what it produced.

The public research-run API is the main testing seam. Tests submit questions through the API and observe results through the API, just like the dashboard does.

## Run locally

You need Node.js 22 or newer and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173`.

The default provider is simulated. It creates clearly labeled sample evidence so you can test the whole product without spending money or adding secrets.

To run the production build locally:

```bash
pnpm build
pnpm start
```

Open `http://127.0.0.1:4100`. The Fastify server serves both the API and the built dashboard.

## Use Groq

Edit `.env`:

```dotenv
RESEARCH_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

Then restart `pnpm dev`.

`openai/gpt-oss-120b` is the recommended model when your Groq organization does not offer Llama 4 Scout. The two Llama Prompt Guard models are safety classifiers; they cannot replace a research model.

The GPT-OSS setup is intentionally conservative for lower Groq quotas. The filings researcher performs one browser-search pass, and the remaining agents analyze the shared evidence. This prevents a single run from launching several large browser sessions.

You can set `GROQ_MODEL=groq/compound` if your organization later offers all of Compound's internal models. The app retains GPT-OSS as a safety fallback for that configuration.

Groq pricing can change. For accurate dashboard cost estimates, set the current prices from your Groq account:

```dotenv
GROQ_INPUT_COST_PER_MILLION=0
GROQ_OUTPUT_COST_PER_MILLION=0
```

When both values are zero, token counts remain accurate but estimated cost stays at `$0.0000`.

## Reliability controls

The important settings live in `.env`:

```dotenv
WORKER_CONCURRENCY=2
QUEUE_POLL_INTERVAL_MS=250
RETRY_BASE_DELAY_MS=1000
RETRY_MAX_DELAY_MS=30000
CACHE_TTL_MS=3600000
```

- `WORKER_CONCURRENCY` is the number of research runs allowed to call the provider at once.
- `RETRY_BASE_DELAY_MS` is the first retry wait. The next wait is twice as long until it reaches the maximum.
- `CACHE_TTL_MS` says how long a completed result is fresh enough to reuse.
- Identical work already in progress is joined instead of queued twice.
- Identical fresh completed work is copied from the cache without a model call.

## Historical batches

The dashboard has a Historical batch tab. Give it one industry and one question per line. Each line becomes a normal durable run, which means caching, deduplication, retries, concurrency limits, and usage tracking still apply.

The HTTP version is:

```bash
curl http://127.0.0.1:4100/api/batches \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Five-year review",
    "items": [
      {
        "industry": "Semiconductor equipment",
        "question": "What changed in industry economics during 2025?",
        "depth": "quick"
      }
    ]
  }'
```

## Verify the project

```bash
pnpm typecheck
pnpm test
pnpm build
```

The tests cover normal completion, in-flight deduplication, completed-result caching, exponential backoff, concurrency limits, queue statistics, and historical batch progress.

## Conductor

The shared Conductor settings add three buttons:

- `dev` runs the dashboard and API using two ports from the workspace's private ten-port range.
- `test` runs the test watcher.
- `verify` runs typechecking, all tests, and the production build.

Run mode is concurrent because each Conductor workspace has its own ports and its own SQLite database file.

## Important production work

Before treating reports as investment-grade research, add licensed financial-data and filing connectors, preserve exact source excerpts, calculate financial metrics in deterministic code, add authentication, and complete legal and compliance review.
