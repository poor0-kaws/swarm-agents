import { researchAgents } from "./agents.js";
import type {
  AgentOutput,
  ResearchProvider,
  ResearchReport,
  ResearchRequest,
} from "./domain.js";
import { ResearchDatabase } from "./database.js";

export class ResearchOrchestrator {
  constructor(
    private readonly database: ResearchDatabase,
    private readonly provider: ResearchProvider,
    private readonly now: () => Date,
  ) {}

  async execute(runId: string, request: ResearchRequest): Promise<ResearchReport> {
    const outputs: AgentOutput[] = [];

    for (const agent of researchAgents) {
      const result = await this.provider.runAgent({
        agent,
        request,
        previousOutputs: outputs,
      });

      outputs.push(result.output);
      this.database.recordAgentResult(
        runId,
        agent.name,
        result,
        this.now().toISOString(),
      );
    }

    return buildReport(request, outputs);
  }
}

function buildReport(request: ResearchRequest, outputs: AgentOutput[]): ResearchReport {
  const usefulOutputs = outputs.filter((_, index) => index > 0 && index < outputs.length - 1);

  return {
    executiveSummary: `The ${request.industry} research swarm completed a ${request.depth} review of: ${request.question}`,
    findings: usefulOutputs.flatMap((output) => {
      const finding = output.findings[0];
      return finding ? [finding] : [];
    }),
    risks: unique(outputs.flatMap((output) => output.risks)),
    sources: uniqueByUrl(outputs.flatMap((output) => output.sources)),
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueByUrl(values: ResearchReport["sources"]) {
  const byUrl = new Map(values.map((value) => [value.url, value]));
  return [...byUrl.values()];
}
