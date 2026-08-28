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
      this.database.recordAgentStarted(runId, agent.name, this.now().toISOString());
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

    const writerOutput = outputs.at(-1);

    if (!writerOutput) {
      throw new Error("The report writer did not return a result.");
    }

    return reportFromWriter(writerOutput, request.depth);
  }
}

function reportFromWriter(
  writerOutput: AgentOutput,
  depth: ResearchRequest["depth"],
): ResearchReport {
  const findingLimits = {
    quick: 3,
    standard: 5,
    deep: 6,
  };

  return {
    executiveSummary: writerOutput.summary,
    findings: writerOutput.findings.slice(0, findingLimits[depth]),
    risks: writerOutput.risks,
    sources: writerOutput.sources,
  };
}
