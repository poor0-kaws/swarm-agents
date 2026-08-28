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
    const depthMultiplier = multiplierForDepth(input.request.depth);
    await delay(Math.max(1, Math.round(this.delayMs * depthMultiplier)));

    const output = createOutput(
      input.agent.name,
      input.request.industry,
      input.previousOutputs,
    );
    const inputTokens = Math.round((180 + input.previousOutputs.length * 45) * depthMultiplier);
    const outputTokens = Math.round((input.agent.name === "report-writer" ? 360 : 140) * depthMultiplier);

    return {
      output,
      model: "simulated-research-model",
      inputTokens,
      outputTokens,
      estimatedCostUsd: Number(((inputTokens + outputTokens) * 0.0000002).toFixed(6)),
    };
  }
}

function createOutput(
  agentName: string,
  industry: string,
  previousOutputs: AgentOutput[],
): AgentOutput {
  if (agentName === "report-writer") {
    return createWriterOutput(industry, previousOutputs);
  }

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

function createWriterOutput(industry: string, previousOutputs: AgentOutput[]): AgentOutput {
  const researchOutputs = previousOutputs.slice(1);
  const sourcesByUrl = new Map(
    researchOutputs.flatMap((output) => output.sources).map((source) => [source.url, source]),
  );

  return {
    summary: `Verified synthesis for ${industry}. The simulated provider demonstrates the workflow and must be replaced with live, licensed evidence for investment use.`,
    findings: researchOutputs.flatMap((output) => output.findings),
    risks: [...new Set(researchOutputs.flatMap((output) => output.risks))],
    sources: [...sourcesByUrl.values()],
  };
}

function multiplierForDepth(depth: "quick" | "standard" | "deep") {
  const multipliers = {
    quick: 0.6,
    standard: 1,
    deep: 1.8,
  };

  return multipliers[depth];
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
