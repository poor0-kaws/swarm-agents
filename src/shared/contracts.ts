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
