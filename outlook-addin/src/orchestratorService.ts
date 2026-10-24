import { assistantService } from "./assistantService";
import type {
  AgentExecutionResult,
  AgentRequest,
  OrchestratorPlan,
  OrchestratorRequest,
  OrchestratorResult,
  OrchestratorStep,
  SpecialistAgentName,
} from "./agentContracts";
import { meetingAgent } from "./meetingAgent";
import { generalResearchAgent } from "./researchAgent";
import { loadSpecialistSkill } from "./skillLoader";
import { taskAgent } from "./taskAgent";
import type { AssistantRequest } from "./assistantService";
import type { SpecialistSkill } from "./skillLoader";

const orchestratorResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    executionMode: { type: "string", enum: ["sequential", "independent"] },
    steps: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["task", "meeting", "research"] },
          requiresPreviousResult: { type: "boolean" },
        },
        required: ["agent", "requiresPreviousResult"],
        additionalProperties: false,
      },
    },
    clarificationQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["executionMode", "steps", "clarificationQuestions"],
  additionalProperties: false,
};

type OrchestratorLlm = { chat(request: AssistantRequest): ReturnType<typeof assistantService.chat> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("The Orchestrator returned invalid JSON. No specialist agent was run; try again.");
  }
}

export function validateOrchestratorPlan(value: unknown): OrchestratorPlan {
  if (!isRecord(value) || (value.executionMode !== "sequential" && value.executionMode !== "independent")
    || !Array.isArray(value.steps) || !Array.isArray(value.clarificationQuestions)) {
    throw new Error("The Orchestrator returned missing or invalid plan fields. No specialist agent was run.");
  }
  if (value.steps.length > 6) throw new Error("The Orchestrator selected too many specialist steps. No agents were run.");
  const allowedAgents = new Set<SpecialistAgentName>(["task", "meeting", "research"]);
  const seen = new Set<SpecialistAgentName>();
  const steps = value.steps.map((item): OrchestratorStep | null => {
    if (!isRecord(item) || typeof item.agent !== "string" || !allowedAgents.has(item.agent as SpecialistAgentName) || typeof item.requiresPreviousResult !== "boolean") {
      throw new Error("The Orchestrator selected an invalid specialist. No agents were run.");
    }
    const agent = item.agent as SpecialistAgentName;
    if (seen.has(agent)) return null;
    seen.add(agent);
    return { agent, requiresPreviousResult: item.requiresPreviousResult };
  }).filter((step): step is OrchestratorStep => step !== null);
  if (steps.length > 3) throw new Error("The Orchestrator selected too many different specialists. No agents were run.");
  const clarificationQuestions = value.clarificationQuestions.map((question) => {
    if (typeof question !== "string") throw new Error("The Orchestrator returned an invalid clarification question.");
    return question.trim();
  }).filter(Boolean);
  if (steps.length === 0 && clarificationQuestions.length === 0) throw new Error("The Orchestrator selected no agent and asked no question.");
  // The first step cannot depend on output from an earlier step in this plan.
  // If it uses previous conversation state, that state is supplied separately.
  if (steps[0]) steps[0] = { ...steps[0], requiresPreviousResult: false };
  const executionMode = steps.some((step) => step.requiresPreviousResult) ? "sequential" : value.executionMode;
  return { executionMode, steps, clarificationQuestions: steps.length ? [] : clarificationQuestions };
}

function skillFor(agent: SpecialistAgentName): SpecialistSkill {
  return agent === "task" ? "task" : agent === "meeting" ? "meeting" : "research";
}

function structuredConversation(request: OrchestratorRequest): string {
  return JSON.stringify({
    activeTaskProposal: request.pendingTaskProposal ? {
      status: request.pendingTaskProposal.status,
      tasks: request.pendingTaskProposal.tasks,
      clarificationQuestions: request.pendingTaskProposal.clarificationQuestions,
    } : null,
    latestMeetingResult: request.latestMeetingResult ?? null,
  });
}

// Treat specialist selection as an authorization boundary: Task Agent may only
// run when the user explicitly asks to create/change a task, or is refining an
// active proposal. The LLM still decides the overall route and other agents.
function taskActionIsRequested(request: OrchestratorRequest): boolean {
  const prompt = request.prompt.toLocaleLowerCase();
  const activeProposalRefinement = Boolean(request.pendingTaskProposal?.status === "proposal"
    && /\b(change|revise|update|add|remove|delete|move|reschedule|make it|instead|actually)\b/.test(prompt));
  const explicitTaskAction = /\b(create|make|add|set up|schedule|plan|update|change|revise|remove|delete|assign)\b[\s\S]{0,60}\b(task|todo|to-do|reminder|follow[- ]?up)\b/i.test(prompt)
    || /\b(task|todo|to-do|reminder|follow[- ]?up)\b[\s\S]{0,60}\b(create|make|add|set up|schedule|plan|update|change|revise|remove|delete|assign)\b/i.test(prompt);
  return activeProposalRefinement || explicitTaskAction;
}

function buildAgentRequest(
  request: OrchestratorRequest,
  skillInstructions: string,
  previousAgentResults: AgentExecutionResult[],
): AgentRequest {
  return {
    userPrompt: request.prompt,
    conversationContext: request.conversationContext,
    skillInstructions,
    availableToolContext: previousAgentResults.flatMap((result) => result.meeting ? [result.meeting] : []),
    previousAgentResults,
    currentEmailContext: request.currentEmailContext,
    pendingTaskProposal: request.pendingTaskProposal,
    latestMeetingResult: request.latestMeetingResult,
    allowMockFallback: request.allowMockFallback,
  };
}

export class BrainOrchestrator {
  constructor(private readonly llm: OrchestratorLlm = assistantService) {}

  async process(request: OrchestratorRequest): Promise<OrchestratorResult> {
    let routingSkill: string;
    try {
      routingSkill = await loadSpecialistSkill("orchestrator");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The Orchestrator skill could not be loaded.";
      return { status: "error", response: detail, agentResults: [], handledBy: [], errors: [detail] };
    }

    let routeReply;
    try {
      routeReply = await this.llm.chat({
        history: [...request.conversationContext.slice(-8), { role: "user", content: request.prompt }],
        emailContext: request.currentEmailContext,
        systemInstructions: [
          routingSkill,
          "Relevant structured state from this conversation (use only if the current request refers to it):",
          structuredConversation(request),
          "Return only JSON matching the supplied orchestration plan schema. Do not execute the request.",
        ].join("\n\n"),
        responseFormat: orchestratorResponseSchema,
        timeoutMs: 120_000,
        maxOutputTokens: 180,
        contextWindow: 8192,
        temperature: 0,
        allowMockFallback: request.allowMockFallback,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The local AI routing request failed.";
      return { status: "unavailable", response: `Local AI is currently unavailable. No agent routing or tool action occurred. ${detail}`, agentResults: [], handledBy: [], errors: [detail] };
    }

    if (routeReply.provider === "mock") {
      return {
        status: "mock-fallback",
        response: `${routeReply.text}\n\nMock fallback only: no specialist was selected, and no task, calendar, email, or preparation action occurred.`,
        agentResults: [],
        handledBy: [],
        provider: "mock",
      };
    }

    let plan: OrchestratorPlan;
    try {
      plan = validateOrchestratorPlan(parseJson(routeReply.text));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The routing plan could not be validated.";
      return { status: "error", response: detail, agentResults: [], handledBy: [], errors: [detail], provider: "local-llm" };
    }

    if (plan.steps.some((step) => step.agent === "task") && !taskActionIsRequested(request)) {
      const steps = plan.steps.filter((step) => step.agent !== "task");
      // A malformed route should still answer an ordinary question. If another
      // suitable specialist remains, preserve the model's valid selection.
      if (!steps.length && !plan.clarificationQuestions.length) {
        steps.push({ agent: "research", requiresPreviousResult: false });
      }
      plan = { ...plan, steps };
    }

    if (plan.steps.length === 0) {
      return { status: "clarification", response: plan.clarificationQuestions.join("\n"), plan, agentResults: [], handledBy: [], provider: "local-llm" };
    }

    const executeStep = async (step: OrchestratorStep, previous: AgentExecutionResult[]): Promise<AgentExecutionResult> => {
      if (step.requiresPreviousResult && !previous.some((result) => result.status === "success")) {
        const response = `Skipped ${step.agent} because its required preceding result was unavailable. No action was taken.`;
        return { agent: step.agent, status: "skipped", response, errors: [response], uiActions: [] };
      }
      let skillInstructions: string;
      try {
        skillInstructions = await loadSpecialistSkill(skillFor(step.agent));
      } catch (error) {
        const detail = error instanceof Error ? error.message : `${step.agent} skill could not be loaded.`;
        return { agent: step.agent, status: "error", response: detail, errors: [detail], uiActions: [] };
      }
      const agentRequest = buildAgentRequest(request, skillInstructions, previous);
      if (step.agent === "task") return taskAgent.execute(agentRequest);
      if (step.agent === "meeting") return meetingAgent.execute(agentRequest);
      return generalResearchAgent.execute(agentRequest);
    };

    let agentResults: AgentExecutionResult[];
    if (plan.executionMode === "independent") {
      agentResults = await Promise.all(plan.steps.map((step) => executeStep(step, [])));
    } else {
      agentResults = [];
      for (const step of plan.steps) agentResults.push(await executeStep(step, [...agentResults]));
    }

    const completed = agentResults.filter((result) => result.status === "success");
    const clarifications = agentResults.filter((result) => result.status === "clarification");
    // MeetingAgentCard renders its structured answer alongside the meeting
    // records. Exclude that same answer from the plain-text response to prevent
    // showing it twice.
    const responseParts = agentResults.filter((result) => result.status !== "skipped" && !result.meeting && result.response.trim()).map((result) => result.response.trim());
    const errors = agentResults.flatMap((result) => result.errors ?? []);
    const failed = agentResults.some((result) => result.status === "error" || result.status === "unavailable" || result.status === "skipped");
    const status: OrchestratorResult["status"] = failed && completed.length ? "partial"
      : failed ? (agentResults.some((result) => result.status === "unavailable") ? "unavailable" : "error")
        : clarifications.length ? (completed.length ? "partial" : "clarification")
          : "success";
    return {
      status,
      response: responseParts.join("\n\n"),
      plan,
      agentResults,
      handledBy: [...new Set(agentResults.filter((result) => result.status !== "skipped").map((result) => result.agent))],
      provider: agentResults.some((result) => result.provider === "mock") ? "mock" : "local-llm",
      ...(errors.length ? { errors } : {}),
    };
  }
}

export const brainOrchestrator = new BrainOrchestrator();
