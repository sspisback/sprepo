import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { labAgent } from "../src/labAgent.ts";

const localFetch = globalThis.fetch.bind(globalThis);
globalThis.window = { setTimeout, clearTimeout };
globalThis.fetch = async (input, init) => {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (path === "/api/knowledge/search") {
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (path.startsWith("/ollama/")) {
    return localFetch(`http://127.0.0.1:11434/${path.slice("/ollama/".length)}`, init);
  }
  return localFetch(input, init);
};

const skill = await readFile(new URL("../skills/lab.md", import.meta.url), "utf8");
const result = await labAgent.execute({
  userPrompt: "Create a five-slide executive deck from this fictional brief: Q3 sales grew 8% versus Q2. Include a title, key finding, implications, risks, and next steps.",
  conversationContext: [],
  skillInstructions: skill,
  previousAgentResults: [],
  allowMockFallback: false,
});
assert.equal(result.status, "success", result.response);
assert.equal(result.provider, "local-llm");
assert.equal(result.labProposal?.actionType, "slide_deck");
assert.ok(result.labProposal.prompt.length > 40, "LLama should return an editable, structured Lab prompt");
console.log("PASS: local llama3.2:3b produced a structured slide-deck proposal through LabAgent.");
