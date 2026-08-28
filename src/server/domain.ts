export const researchDepths = ["quick", "standard", "deep"] as const;

export type ResearchDepth = (typeof researchDepths)[number];

export const runStatuses = [
  "queued",
  "running",
  "retrying",
  "completed",
  "failed",
] as const;

export type RunStatus = (typeof runStatuses)[number];

export type ReuseKind = "cached" | "deduplicated" | null;

export interface ResearchRequest {
  industry: string;
  question: string;
  depth: ResearchDepth;
}

export interface Finding {
  title: string;
  detail: string;
  confidence: "low" | "medium" | "high";
}

export interface SourceReference {
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string;
}

export interface ResearchReport {
  executiveSummary: string;
  findings: Finding[];
  risks: string[];
  sources: SourceReference[];
}

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
  fingerprint: string;
  status: RunStatus;
  reuseKind: ReuseKind;
  sourceRunId: string | null;
  report: ResearchReport | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface AgentUsage {
  id: string;
  runId: string;
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface AgentDefinition {
  name: string;
  purpose: string;
  tools: string[];
}

export interface AgentOutput {
  summary: string;
  findings: Finding[];
  risks: string[];
  sources: SourceReference[];
}

export interface ProviderResult {
  output: AgentOutput;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ResearchProvider {
  readonly version: string;
  runAgent(input: {
    agent: AgentDefinition;
    request: ResearchRequest;
    previousOutputs: AgentOutput[];
  }): Promise<ProviderResult>;
}

export class RetryableProviderError extends Error {
  readonly retryable = true;
}
