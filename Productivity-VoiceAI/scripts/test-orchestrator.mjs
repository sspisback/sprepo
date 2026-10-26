import assert from "node:assert/strict";
import { BrainOrchestrator, labRoutingCandidate } from "../src/orchestratorService.ts";
import { LabAgent } from "../src/labAgent.ts";
import { MockLabIntegrationService } from "../src/mockLabIntegrationService.ts";

const dispatched = [];
const fakeResult = (agent, extra = {}) => ({ agent, status: "success", response: `${agent} response`, uiActions: [], ...extra });
const fakeAgents = Object.fromEntries(["task", "meeting", "research", "lab"].map((name) => [name, {
  async execute(request) { dispatched.push({ name, request }); return fakeResult(name, name === "lab" ? { labProposal: { proposalId: "p1", status: "proposal", actionType: "slide_deck", originalRequest: request.userPrompt, clientProject: "", prompt: "Mock editable prompt", clarificationQuestions: [], sources: [] } } : {}); },
}]));
let routeCalls = 0;
let lastRouteRequest;
const fakeLlm = { async chat({ history, systemInstructions }) {
  lastRouteRequest = { history, systemInstructions };
  routeCalls++;
  const prompt = history.at(-1)?.content ?? "";
  if (/find my meetings today and create a task/i.test(prompt)) return { text: JSON.stringify({ executionMode: "sequential", steps: [{ agent: "meeting", requiresPreviousResult: false }, { agent: "task", requiresPreviousResult: true }], clarificationQuestions: [] }), provider: "local-llm" };
  const agent = (/second one/i.test(prompt) && /latestMeetingResult":\{/.test(systemInstructions) || /meeting|calendar/i.test(prompt)) ? "meeting" : /lab|slides|deck|presentation|latest project data/i.test(prompt) ? "lab" : /chase|task|change the due date/i.test(prompt) ? "task" : "research";
  return { text: JSON.stringify({ executionMode: "sequential", steps: [{ agent, requiresPreviousResult: false }], clarificationQuestions: [] }), provider: "local-llm" };
} };
const orchestrator = new BrainOrchestrator(fakeLlm, {
  ...fakeAgents,
  async loadSkill(name) { return `test ${name} skill`; },
});
async function route(prompt, expected, expectedRouteCalls, context = {}) {
  dispatched.length = 0;
  const before = routeCalls;
  const result = await orchestrator.process({ prompt, conversationContext: [], allowMockFallback: false, ...context });
  assert.deepEqual(result.handledBy, [expected], `${prompt} should route to ${expected}`);
  assert.deepEqual(dispatched.map((item) => item.name), [expected]);
  assert.equal(routeCalls - before, expectedRouteCalls, `${prompt}: router invocation count`);
}

await route("What is revenue analysis?", "research", 0);
await route("What is Lab?", "research", 0);
await route("What caused the revenue decline in my uploaded report?", "research", 0);
await route("What meetings are important today?", "meeting", 1);
await route("Prepare me for the second one.", "meeting", 1, { latestMeetingResult: { intent: "list", answer: "Two meetings", scopeLabel: "Today", meetings: [{ id: "m1" }, { id: "m2" }], importanceRationales: [], conflicts: [], simulated: true } });
await route("Chase Jonas for the final revenue report, then analyse the data and present it next Wednesday", "task", 0);
await route("Need to chase Peter for the financial analysis. Book the dentist appointment for Thursday. Also need to prepare for client presentation on 30th", "task", 0);
await route("Dentist appo on Monday. Finish reviewing the slide deck from client and chase Ashwin", "task", 0);
await route("Ask Peter for the final draft by end of tomorrow. Analyse the content and prepare for client meeting on Friday", "task", 0);
await route("Prepare for the client presentation", "task", 0);
await route("Change the due date to Friday", "task", 0, { pendingTaskProposal: { status: "proposal", tasks: [{ taskId: "t1" }], clarificationQuestions: [] } });
await route("Create a slide deck from the attached project brief", "lab", 1);
await route("Send this request to Lab", "lab", 1);
await route("Analyse the latest project data and prepare a client presentation", "lab", 1);
await route("Create a task to follow up with Jonas", "task", 0);
await route("Need to go to the dentist on Monday. Will have to finish the financial planning for Tesco latest by tomorrow", "task", 0);
await route("I have to send the client the revised proposal by Friday", "task", 0);
await route("Should I go to the dentist on Monday?", "research", 0);

dispatched.length = 0;
const labAfterTask = await orchestrator.process({
  prompt: "Create a slide deck for the onboarding workshop",
  conversationContext: [{ role: "user", content: "Chase Jonas for the final revenue report" }, { role: "assistant", content: "Task proposal for Jonas" }],
  pendingTaskProposal: { status: "proposal", tasks: [{ taskId: "t1", title: "Chase Jonas" }], clarificationQuestions: [] },
  allowMockFallback: false,
});
assert.deepEqual(labAfterTask.handledBy, ["lab"]);
assert.equal(lastRouteRequest.history.length, 1, "Lab routing should receive only the current user request");
assert.doesNotMatch(lastRouteRequest.systemInstructions, /Jonas/, "Lab routing must not receive the active Task proposal");
assert.deepEqual(dispatched[0].request.conversationContext, [], "LabAgent requests exclude unrelated chat turns");
assert.equal(dispatched[0].request.pendingTaskProposal, null, "LabAgent requests exclude the pending Task proposal");

dispatched.length = 0;
const combined = await orchestrator.process({ prompt: "Find my meetings today and create a task for the first one", conversationContext: [], allowMockFallback: false });
assert.deepEqual(combined.handledBy, ["meeting", "task"], "meeting-plus-task flow should preserve both specialists");
assert.equal(dispatched[1].request.previousAgentResults[0].agent, "meeting", "Task Agent should receive the preceding meeting result");

assert.equal(labRoutingCandidate({ prompt: "What is revenue analysis?", conversationContext: [], allowMockFallback: false }), false);
assert.equal(labRoutingCandidate({ prompt: "Create a slide deck about the project", conversationContext: [], allowMockFallback: false }), true);
assert.equal(labRoutingCandidate({ prompt: "Ask Peter for the final draft by end of tomorrow. Analyse the content and prepare for client meeting on Friday", conversationContext: [], allowMockFallback: false }), false);
assert.equal(labRoutingCandidate({ prompt: "Atlas is the project name", conversationContext: [], pendingLabProposal: { status: "clarification" }, allowMockFallback: false }), true);
console.log("PASS: Research/RAG, Meeting and meeting follow-up, Task and task refinement, sequential Meeting→Task, Lab deck, explicit Lab, project analysis, and route candidate gates.");

let capturedRequest;
const fakeLabLlm = { async chat(request) {
  capturedRequest = request;
  return { text: JSON.stringify({ outcome: "proposal", actionType: "analysis", clientProject: "Example project", prompt: "Assess the supplied project data and report findings.", clarificationQuestions: [] }), provider: "local-llm" };
} };
const labResult = await new LabAgent(fakeLabLlm).execute({
  userPrompt: "Analyse this email for the project and prepare a Lab request",
  conversationContext: [{ role: "user", content: "Chase Jonas for the final revenue report" }], skillInstructions: "Editable lab skill fixture",
  previousAgentResults: [], currentEmailContext: "Project asks for a market analysis.",
  pendingTaskProposal: null, pendingLabProposal: null, allowMockFallback: false,
});
assert.equal(labResult.labProposal?.actionType, "analysis");
assert.match(capturedRequest.systemInstructions, /Editable lab skill fixture/);
assert.equal(capturedRequest.emailContext, "Project asks for a market analysis.");
assert.deepEqual(capturedRequest.history, [{ role: "user", content: "Analyse this email for the project and prepare a Lab request" }], "Lab model history should contain only the current request");
assert.doesNotMatch(capturedRequest.systemInstructions, /Jonas/, "Lab model instructions should not contain stale task names");
console.log("PASS: LabAgent passes skill and supplied email context to its local-model boundary and returns structured proposal.");

globalThis.window = { setTimeout, location: { origin: "https://localhost:3000" } };
const mockLab = new MockLabIntegrationService();
const submissionInput = { requestId: "idempotency-test", prompt: "Create a fictional deck", actionType: "slide_deck", clientProject: "Example", sources: [] };
const submission = await mockLab.submit(submissionInput);
const duplicateSubmission = await mockLab.submit(submissionInput);
assert.equal(submission.status, "submitted");
assert.equal(submission.simulated, true);
assert.equal(submission.jobId, duplicateSubmission.jobId, "same request ID must be idempotent");
assert.match(submission.resultUrl, /#lab-result\//);
console.log("PASS: Local mock submission is delayed, labelled simulated/submitted, linkable, and idempotent.");
