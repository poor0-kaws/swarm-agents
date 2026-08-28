import { z } from "zod";

import {
  RetryableProviderError,
  type AgentOutput,
  type ResearchProvider,
} from "../domain.js";

interface GroqProviderOptions {
  apiKey: string;
  model?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

const GPT_OSS_FALLBACK_MODEL = "openai/gpt-oss-120b";

class BlockedModelError extends Error {}

const outputSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().min(1),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(8),
  risks: z.array(z.string()).max(8),
  sources: z.array(z.object({
    title: z.string().min(1),
    url: z.string().url(),
    sourceType: z.string().min(1),
    publishedAt: z.string().min(1),
  })).max(12),
});

export class GroqResearchProvider implements ResearchProvider {
  readonly version: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly inputCostPerMillion: number;
  private readonly outputCostPerMillion: number;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "groq/compound";
    this.version = providerVersion(this.model);
    this.inputCostPerMillion = options.inputCostPerMillion ?? 0;
    this.outputCostPerMillion = options.outputCostPerMillion ?? 0;
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    const result = await this.requestWithFallback(input);
    const content = result.payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new RetryableProviderError("Groq returned an empty agent response.");
    }

    const output = parseAgentOutput(content);
    const inputTokens = result.payload.usage?.prompt_tokens ?? 0;
    const outputTokens = result.payload.usage?.completion_tokens ?? 0;

    return {
      output,
      model: result.model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: calculateCost(
        inputTokens,
        outputTokens,
        this.inputCostPerMillion,
        this.outputCostPerMillion,
      ),
    };
  }

  private async requestWithFallback(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    const primaryBody = buildRequestBody(input, this.model);

    try {
      return {
        payload: await this.createCompletion(primaryBody),
        model: this.model,
      };
    } catch (error) {
      const primaryCanFallback = error instanceof BlockedModelError
        || error instanceof RetryableProviderError;

      if (!primaryCanFallback || !this.model.startsWith("groq/compound")) {
        throw error;
      }

      const fallbackBody = buildRequestBody(input, GPT_OSS_FALLBACK_MODEL);
      return {
        payload: await this.createCompletion(fallbackBody),
        model: GPT_OSS_FALLBACK_MODEL,
      };
    }
  }

  private async createCompletion(body: Record<string, unknown>) {
    const maximumAttempts = 5;
    let networkFailures = 0;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let response: Response;

      try {
        response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Groq-Model-Version": "latest",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (error) {
        networkFailures += 1;
        const isCompoundRequest = typeof body.model === "string"
          && body.model.startsWith("groq/compound");

        if (!isCompoundRequest && networkFailures < 2) {
          await delay(500);
          continue;
        }

        const message = error instanceof Error ? error.message : "Network request failed.";
        throw new RetryableProviderError(`Groq did not respond: ${message}`);
      }

      const payload = await response.json() as GroqResponse;

      if (response.ok) {
        return payload;
      }

      const message = payload.error?.message ?? `Groq request failed with status ${response.status}.`;

      if (response.status === 403 && message.includes("blocked at the organization level")) {
        throw new BlockedModelError(message);
      }

      if (response.status === 429 && attempt < maximumAttempts) {
        const retryDelayMs = rateLimitDelayMs(response, attempt);

        if (retryDelayMs > 30_000) {
          throw new RetryableProviderError(message, { retryAfterMs: retryDelayMs });
        }

        await delay(retryDelayMs);
        continue;
      }

      if (isRequestTooLarge(response.status, message) && attempt < maximumAttempts) {
        reduceCompletionBudget(body);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        throw new RetryableProviderError(message);
      }

      throw new Error(`Groq request failed (${response.status}): ${message}`);
    }

    throw new RetryableProviderError("Groq did not accept the request after repeated attempts.");
  }
}

function buildRequestBody(
  input: Parameters<ResearchProvider["runAgent"]>[0],
  model: string,
) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(input.agent.purpose),
      },
      {
        role: "user",
        content: buildUserPrompt(input, model),
      },
    ],
    temperature: 0.1,
    max_completion_tokens: completionBudget(input.request.depth),
  };

  addReasoningConfiguration(body, model, input.request.depth);
  addToolConfiguration(body, model, input.agent.name, input.agent.tools);
  return body;
}

function providerVersion(model: string) {
  if (!model.startsWith("groq/compound")) {
    return `groq:${model}`;
  }

  return `groq:${model}+fallback:${GPT_OSS_FALLBACK_MODEL}:single-search-v1`;
}

function buildSystemPrompt(purpose: string) {
  return [
    "You are one member of a financial industry research team.",
    purpose,
    "Treat source quality and dates as important.",
    "Separate facts from interpretation.",
    "Return JSON only. Do not wrap it in markdown.",
  ].join(" ");
}

function buildUserPrompt(
  input: Parameters<ResearchProvider["runAgent"]>[0],
  model: string,
) {
  const limits = outputLimits(input.request.depth);

  return JSON.stringify({
    assignment: input.agent.name,
    allowedTools: toolsAvailableToAgent(model, input.agent.name, input.agent.tools),
    industry: input.request.industry,
    question: input.request.question,
    depth: input.request.depth,
    previousResearch: relevantPreviousResearch(input),
    limits,
    requiredOutput: {
      summary: "Factual summary, at most 35 words",
      findings: [{ title: "Finding title", detail: "Supported detail, at most 35 words", confidence: "low | medium | high" }],
      risks: ["Material risk, at most 20 words"],
      sources: [{
        title: "Source title",
        url: "https://source.example/path",
        sourceType: "filing | regulator | company | news | data",
        publishedAt: "YYYY-MM-DD",
      }],
    },
  });
}

function toolsAvailableToAgent(model: string, agentName: string, configuredTools: string[]) {
  if (!model.startsWith("openai/gpt-oss")) {
    return configuredTools;
  }

  const isEvidenceCollector = agentName === "filings-researcher";
  if (isEvidenceCollector && agentNeedsWebSearch(configuredTools)) {
    return ["browser-search"];
  }

  return [];
}

function relevantPreviousResearch(input: Parameters<ResearchProvider["runAgent"]>[0]) {
  if (input.agent.name === "report-writer" || input.agent.name === "verifier") {
    return input.previousOutputs.map(compactOutput);
  }

  const plannerOutput = input.previousOutputs[0];
  const gatheredEvidence = input.previousOutputs[1];
  const usefulOutputs = [plannerOutput, gatheredEvidence].filter(
    (output): output is AgentOutput => output !== undefined,
  );
  return usefulOutputs.map(compactOutput);
}

function compactOutput(output: AgentOutput): AgentOutput {
  return {
    summary: output.summary,
    findings: output.findings.slice(0, 3),
    risks: output.risks.slice(0, 3),
    sources: output.sources.slice(0, 4),
  };
}

function completionBudget(depth: "quick" | "standard" | "deep") {
  const budgets = {
    quick: 650,
    standard: 1_000,
    deep: 1_600,
  };

  return budgets[depth];
}

function outputLimits(depth: "quick" | "standard" | "deep") {
  const limits = {
    quick: { findings: 2, risks: 2, sources: 4 },
    standard: { findings: 4, risks: 4, sources: 6 },
    deep: { findings: 6, risks: 6, sources: 8 },
  };

  return limits[depth];
}

function reasoningEffort(depth: "quick" | "standard" | "deep") {
  const efforts = {
    quick: "low",
    standard: "medium",
    deep: "high",
  } as const;

  return efforts[depth];
}

function addReasoningConfiguration(
  body: Record<string, unknown>,
  model: string,
  depth: "quick" | "standard" | "deep",
) {
  if (!model.startsWith("openai/gpt-oss")) {
    return;
  }

  body.reasoning_effort = reasoningEffort(depth);
}

function addToolConfiguration(
  body: Record<string, unknown>,
  model: string,
  agentName: string,
  agentTools: string[],
) {
  const needsWebSearch = agentNeedsWebSearch(agentTools);
  const needsCalculator = agentTools.includes("calculator");

  if (model.startsWith("groq/compound")) {
    const enabledTools: string[] = [];

    if (needsWebSearch) {
      enabledTools.push("web_search", "visit_website");
    }

    if (needsCalculator) {
      enabledTools.push("code_interpreter");
    }

    if (enabledTools.length === 0) {
      body.tool_choice = "none";
      body.response_format = { type: "json_object" };
      return;
    }

    body.compound_custom = { tools: { enabled_tools: enabledTools } };

    return;
  }

  if (model.startsWith("openai/gpt-oss")) {
    const tools: Array<{ type: string }> = [];
    const isEvidenceCollector = agentName === "filings-researcher";

    if (needsWebSearch && isEvidenceCollector) {
      tools.push({ type: "browser_search" });
    }

    if (tools.length > 0) {
      body.tools = tools;
      return;
    }

    body.response_format = { type: "json_object" };
  }
}

function agentNeedsWebSearch(tools: string[]) {
  const toolsThatNeedSearch = [
    "web-search",
    "sec-filings",
    "market-data",
    "regulatory-data",
    "source-checker",
  ];
  return tools.some((tool) => toolsThatNeedSearch.includes(tool));
}

export function parseAgentOutput(content: string): AgentOutput {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [cleaned, ...extractJsonObjects(cleaned)];

  for (const candidate of candidates) {
    try {
      return outputSchema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  throw new RetryableProviderError("Groq returned research in an unexpected format.");
}

function extractJsonObjects(content: string) {
  const objects: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        objectStart = index;
      }

      depth += 1;
      continue;
    }

    if (character !== "}" || depth === 0) {
      continue;
    }

    depth -= 1;

    if (depth === 0 && objectStart >= 0) {
      objects.push(content.slice(objectStart, index + 1));
      objectStart = -1;
    }
  }

  return objects;
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputCostPerMillion: number,
  outputCostPerMillion: number,
) {
  const inputCost = inputTokens / 1_000_000 * inputCostPerMillion;
  const outputCost = outputTokens / 1_000_000 * outputCostPerMillion;
  return Number((inputCost + outputCost).toFixed(6));
}

export function rateLimitDelayMs(response: Response, attempt: number) {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1_000), 15 * 60 * 1_000);
  }

  return Math.min(500 * 2 ** (attempt - 1), 8_000);
}

function isRequestTooLarge(status: number, message: string) {
  if (status !== 400 && status !== 413) {
    return false;
  }

  return message.toLowerCase().includes("reduce the length");
}

function reduceCompletionBudget(body: Record<string, unknown>) {
  const currentBudget = body.max_completion_tokens;

  if (typeof currentBudget !== "number") {
    return;
  }

  body.max_completion_tokens = Math.max(256, Math.floor(currentBudget / 2));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
