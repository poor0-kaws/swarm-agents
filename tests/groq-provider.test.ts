import { afterEach, describe, expect, test, vi } from "vitest";

import {
  GroqResearchProvider,
  parseAgentOutput,
  rateLimitDelayMs,
} from "../src/server/providers/groq-provider.js";

describe("Groq research output", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("extracts a valid research object from surrounding model text", () => {
    const content = `I checked the requested format.

\`\`\`json
{
  "summary": "Demand is driven by denser computing infrastructure.",
  "findings": [
    {
      "title": "Rack density is rising",
      "detail": "Higher rack density increases cooling requirements.",
      "confidence": "medium"
    }
  ],
  "risks": ["Power constraints can delay projects."],
  "sources": [
    {
      "title": "Example source",
      "url": "https://example.com/research",
      "sourceType": "company",
      "publishedAt": "2026-01-15"
    }
  ]
}
\`\`\`
Done.`;

    const output = parseAgentOutput(content);

    expect(output.summary).toBe("Demand is driven by denser computing infrastructure.");
    expect(output.findings).toHaveLength(1);
    expect(output.sources[0]?.url).toBe("https://example.com/research");
  });

  test("uses Groq's retry delay for a rate-limited agent call", () => {
    const response = new Response(null, {
      status: 429,
      headers: { "retry-after": "2.895" },
    });

    expect(rateLimitDelayMs(response, 1)).toBe(2_895);
  });

  test("passes a long provider delay to the durable queue", () => {
    const response = new Response(null, {
      status: 429,
      headers: { "retry-after": "120" },
    });

    expect(rateLimitDelayMs(response, 1)).toBe(120_000);
  });

  test("falls back to GPT-OSS when Compound selects a blocked internal model", async () => {
    const output = {
      summary: "A short plan.",
      findings: [],
      risks: [],
      sources: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: "The model is blocked at the organization level.",
        },
      }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GroqResearchProvider({
      apiKey: "test-key",
      model: "groq/compound",
    });
    const result = await provider.runAgent({
      agent: {
        name: "planner",
        purpose: "Create a small research plan.",
        tools: [],
      },
      request: {
        industry: "Data center cooling",
        question: "What drives demand and creates risk in 2026?",
        depth: "quick",
      },
      previousOutputs: [],
    });

    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    const fallbackPrompt = JSON.parse(secondBody.messages[1].content);
    expect(firstBody.model).toBe("groq/compound");
    expect(secondBody.model).toBe("openai/gpt-oss-120b");
    expect(secondBody.tools).toBeUndefined();
    expect(secondBody.response_format).toEqual({ type: "json_object" });
    expect(fallbackPrompt.allowedTools).toEqual([]);
    expect(result.model).toBe("openai/gpt-oss-120b");
  });
});
