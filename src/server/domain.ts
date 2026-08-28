import type {
  Finding,
  ResearchDepth,
  ResearchReport,
  ReuseKind,
  RunStatus,
  SourceReference,
} from "../shared/contracts.js";

export {
  researchDepths,
  runStatuses,
  type BatchSummary,
  type Finding,
  type ResearchDepth,
  type ResearchReport,
  type ReuseKind,
  type RunStatus,
  type SourceReference,
  type UsageSummary,
} from "../shared/contracts.js";

export interface ResearchRequest {
  industry: string;
  question: string;
  depth: ResearchDepth;
}

export interface ResearchRun {
  id: string;
  industry: string;
  question: string;
  depth: ResearchDepth;
  fingerprint: string;
  status: RunStatus;
  currentAgent: string | null;
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
