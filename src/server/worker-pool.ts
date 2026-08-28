import type { ResearchRequest } from "./domain.js";
import { ResearchDatabase, type QueueJob } from "./database.js";
import { RetryableProviderError } from "./domain.js";
import { ResearchOrchestrator } from "./orchestrator.js";

interface WorkerPoolOptions {
  concurrency: number;
  pollIntervalMs: number;
  cacheTtlMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  now: () => Date;
}

export class WorkerPool {
  private readonly activeJobs = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly database: ResearchDatabase,
    private readonly orchestrator: ResearchOrchestrator,
    private readonly options: WorkerPoolOptions,
  ) {}

  start() {
    this.schedulePoll(0);
  }

  async stop() {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await Promise.allSettled(this.activeJobs);
  }

  private schedulePoll(delayMs: number) {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => this.poll(), delayMs);
  }

  private poll() {
    while (this.activeJobs.size < this.options.concurrency) {
      const now = this.options.now().toISOString();
      const job = this.database.claimNextJob(now);

      if (!job) {
        break;
      }

      const promise = this.executeJob(job);
      this.activeJobs.add(promise);
      void promise.finally(() => this.activeJobs.delete(promise));
    }

    this.schedulePoll(this.options.pollIntervalMs);
  }

  private async executeJob(job: QueueJob) {
    const run = this.database.getRun(job.run_id);

    if (!run) {
      this.database.failJob(job.id, job.run_id, "Research run no longer exists.", this.options.now().toISOString());
      return;
    }

    const request: ResearchRequest = {
      industry: run.industry,
      question: run.question,
      depth: run.depth,
    };

    try {
      const report = await this.orchestrator.execute(job.run_id, request);
      const completedAt = this.options.now();
      const cacheExpiresAt = new Date(
        completedAt.getTime() + this.options.cacheTtlMs,
      ).toISOString();
      this.database.completeJob(
        job.id,
        job.run_id,
        report,
        completedAt.toISOString(),
        cacheExpiresAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Research provider failed.";

      if (error instanceof RetryableProviderError && job.attempts < job.max_attempts) {
        this.scheduleRetry(job, message);
        return;
      }

      this.database.failJob(job.id, job.run_id, message, this.options.now().toISOString());
    }
  }

  private scheduleRetry(job: QueueJob, message: string) {
    const delayMs = Math.min(
      this.options.retryBaseDelayMs * 2 ** (job.attempts - 1),
      this.options.retryMaxDelayMs,
    );
    const now = this.options.now();
    const availableAt = new Date(now.getTime() + delayMs).toISOString();

    this.database.retryJob(
      job.id,
      job.run_id,
      message,
      now.toISOString(),
      availableAt,
      job.attempts + 1,
      delayMs,
    );
  }
}
