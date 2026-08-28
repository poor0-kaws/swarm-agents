export type RunStatus = "queued" | "running" | "retrying" | "completed" | "failed";
export type ResearchDepth = "quick" | "standard" | "deep";

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ResearchRun {
  id: string;
  industry: string;
  question: string;
  depth: ResearchDepth;
  status: RunStatus;
  reuseKind: "cached" | "deduplicated" | null;
  sourceRunId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  usage: UsageSummary;
}

export interface ResearchReport {
  executiveSummary: string;
  findings: Array<{
    title: string;
    detail: string;
    confidence: "low" | "medium" | "high";
  }>;
  risks: string[];
  sources: Array<{
    title: string;
    url: string;
    sourceType: string;
    publishedAt: string;
  }>;
}

export interface RunDetail extends ResearchRun {
  report: ResearchReport | null;
  events: Array<{
    id: string;
    type: string;
    message: string;
    createdAt: string;
  }>;
  usageRecords: Array<{
    id: string;
    agentName: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>;
}

export interface QueueStats {
  queued: number;
  active: number;
  retrying: number;
  completed: number;
  failed: number;
  concurrency: number;
}

export interface CreateRunInput {
  industry: string;
  question: string;
  depth: ResearchDepth;
}

export interface CreateBatchInput {
  name: string;
  items: CreateRunInput[];
}

export async function listRuns() {
  return request<ResearchRun[]>("/api/runs");
}

export async function getRun(runId: string) {
  return request<RunDetail>(`/api/runs/${runId}`);
}

export async function getQueueStats() {
  return request<QueueStats>("/api/queue");
}

export async function createRun(input: CreateRunInput) {
  return request<ResearchRun>("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createBatch(input: CreateBatchInput) {
  return request<{ id: string; name: string; runIds: string[] }>("/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json() as unknown;

  if (!response.ok) {
    throw new Error(readErrorMessage(body));
  }

  return body as T;
}

function readErrorMessage(body: unknown) {
  if (
    typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "string"
  ) {
    return body.error;
  }

  return "The server could not complete the request.";
}
