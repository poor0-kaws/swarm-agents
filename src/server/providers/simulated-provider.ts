import type {
  AgentOutput,
  ResearchProvider,
  ProviderResult,
} from "../domain.js";

interface SimulatedProviderOptions {
  delayMs?: number;
}

export class SimulatedResearchProvider implements ResearchProvider {
  readonly version = "simulated-v1";
  private readonly delayMs: number;

  constructor(options: SimulatedProviderOptions = {}) {
    this.delayMs = options.delayMs ?? 80;
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]): Promise<ProviderResult> {
    await delay(this.delayMs);

    const output = createOutput(input.agent.name, input.request.industry);
    const inputTokens = 180 + input.previousOutputs.length * 45;
    const outputTokens = input.agent.name === "report-writer" ? 360 : 140;

    return {
      output,
      model: "simulated-research-model",
      inputTokens,
      outputTokens,
      estimatedCostUsd: Number(((inputTokens + outputTokens) * 0.0000002).toFixed(6)),
    };
  }
}

function createOutput(agentName: string, industry: string): AgentOutput {
  const findings = [
    {
      title: findingTitle(agentName),
      detail: `${agentName} identified a material consideration for the ${industry} industry. Connect a live Groq provider and licensed data tools to replace this simulated evidence.`,
      confidence: "medium" as const,
    },
  ];

  return {
    summary: `${agentName} completed its review of ${industry}.`,
    findings,
    risks: agentName === "risk-researcher"
      ? ["Demand can change faster than historical industry data reflects."]
      : [],
    sources: [
      {
        title: "Simulated evidence source",
        url: "https://example.com/simulated-source",
        sourceType: "simulation",
        publishedAt: "2026-01-01",
      },
    ],
  };
}

function findingTitle(agentName: string) {
  const titles: Record<string, string> = {
    planner: "Research plan defined",
    "filings-researcher": "Filings evidence collected",
    "market-researcher": "Market structure compared",
    "news-researcher": "Recent developments reviewed",
    "risk-researcher": "Downside cases identified",
    verifier: "Evidence consistency checked",
    "report-writer": "Verified findings synthesized",
  };

  return titles[agentName] ?? "Research completed";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
