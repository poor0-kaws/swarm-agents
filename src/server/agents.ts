import type { AgentDefinition } from "./domain.js";

export const researchAgents: AgentDefinition[] = [
  {
    name: "planner",
    purpose: "Break the research question into a small, complete investigation plan.",
    tools: [],
  },
  {
    name: "filings-researcher",
    purpose: "Find durable facts in company and regulator filings.",
    tools: ["sec-filings", "document-reader"],
  },
  {
    name: "market-researcher",
    purpose: "Compare market structure, competitors, growth, and pricing power.",
    tools: ["market-data", "calculator"],
  },
  {
    name: "news-researcher",
    purpose: "Find recent events that can change the industry view.",
    tools: ["web-search", "website-reader"],
  },
  {
    name: "risk-researcher",
    purpose: "Build the strongest regulatory, supply-chain, and downside cases.",
    tools: ["web-search", "regulatory-data"],
  },
  {
    name: "verifier",
    purpose: "Find conflicts, unsupported claims, stale evidence, and missing context.",
    tools: ["source-checker", "calculator"],
  },
  {
    name: "report-writer",
    purpose: "Turn verified evidence into a concise report without adding new facts.",
    tools: [],
  },
];
