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
    this.version = `groq:${this.model}`;
    this.inputCostPerMillion = options.inputCostPerMillion ?? 0;
    this.outputCostPerMillion = options.outputCostPerMillion ?? 0;
  }

  async runAgent(input: Parameters<ResearchProvider["runAgent"]>[0]) {
    const enabledTools = mapBuiltInTools(input.agent.tools);
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(input.agent.purpose),
        },
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
      temperature: 0.1,
    };

    if (this.model.startsWith("groq/compound") && enabledTools.length > 0) {
      body.compound_custom = {
        tools: { enabled_tools: enabledTools },
      };
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as GroqResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `Groq request failed with status ${response.status}.`;

      if (response.status === 429 || response.status >= 500) {
        throw new RetryableProviderError(message);
      }

      throw new Error(message);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new RetryableProviderError("Groq returned an empty agent response.");
    }

    const output = parseAgentOutput(content);
    const inputTokens = payload.usage?.prompt_tokens ?? 0;
    const outputTokens = payload.usage?.completion_tokens ?? 0;

    return {
      output,
      model: this.model,
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

function buildUserPrompt(input: Parameters<ResearchProvider["runAgent"]>[0]) {
  return JSON.stringify({
    assignment: input.agent.name,
    allowedTools: input.agent.tools,
    industry: input.request.industry,
    question: input.request.question,
    depth: input.request.depth,
    previousResearch: input.previousOutputs,
    requiredOutput: {
      summary: "Short factual summary",
      findings: [{ title: "Finding title", detail: "Supported detail", confidence: "low | medium | high" }],
      risks: ["Material risk"],
      sources: [{
        title: "Source title",
        url: "https://source.example/path",
        sourceType: "filing | regulator | company | news | data",
        publishedAt: "YYYY-MM-DD",
      }],
    },
  });
}

function mapBuiltInTools(tools: string[]) {
  const builtInTools = new Set<string>();

  if (tools.includes("web-search")) {
    builtInTools.add("web_search");
  }

  if (tools.includes("website-reader") || tools.includes("document-reader")) {
    builtInTools.add("visit_website");
  }

  if (tools.includes("calculator")) {
    builtInTools.add("code_interpreter");
  }

  return [...builtInTools];
}

function parseAgentOutput(content: string): AgentOutput {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return outputSchema.parse(JSON.parse(cleaned));
  } catch {
    throw new RetryableProviderError("Groq returned research in an unexpected format.");
  }
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
