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
import { labAgent } from "./labAgent";
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
          agent: { type: "string", enum: ["task", "meeting", "research", "lab"] },
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
type AgentExecutor = { execute(request: AgentRequest): Promise<AgentExecutionResult> };
type OrchestratorDependencies = {
  task: AgentExecutor;
  meeting: AgentExecutor;
  research: AgentExecutor;
  lab: AgentExecutor;
  loadSkill: typeof loadSpecialistSkill;
};

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
  const allowedAgents = new Set<SpecialistAgentName>(["task", "meeting", "research", "lab"]);
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
  return agent === "task" ? "task" : agent === "meeting" ? "meeting" : agent === "lab" ? "lab" : "research";
}

function structuredConversation(request: OrchestratorRequest, labOnly = false): string {
  return JSON.stringify({
    activeTaskProposal: !labOnly && request.pendingTaskProposal ? {
      status: request.pendingTaskProposal.status,
      tasks: request.pendingTaskProposal.tasks,
      clarificationQuestions: request.pendingTaskProposal.clarificationQuestions,
    } : null,
    activeLabProposal: request.pendingLabProposal ? {
      status: request.pendingLabProposal.status,
      actionType: request.pendingLabProposal.actionType,
      clientProject: request.pendingLabProposal.clientProject,
      prompt: request.pendingLabProposal.prompt,
      sources: request.pendingLabProposal.sources.map((source) => source.filename),
    } : null,
    latestMeetingResult: labOnly ? null : request.latestMeetingResult ?? null,
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
  // Users often provide task descriptions as direct instructions rather than
  // saying "create a task". Recognize an imperative action at the start of the
  // prompt (including multi-step instructions) so ordinary free text reaches
  // Task Agent instead of the direct-to-Research path.
  const actionVerb = "(?:ask|chase|follow[ -]?up|analyse|analyze|review|investigate|call|contact|email|message|send|draft|write|prepare|present|deliver|compile|create|build|update|complete|finish|submit|share|coordinate|arrange|book|schedule|organize|organise|collect|gather|confirm|resolve|fix|implement|test|discuss|request|remind|go|attend|visit)";
  const actionClauses = request.prompt.split(/[\n.!?;]+|\bthen\b/i).map((clause) => clause.trim()).filter(Boolean);
  const imperativeStart = actionClauses.some((clause) => new RegExp(`^(?:(?:please|also|and|i need to|i need you to|i want to|i want you to|can you|could you|would you|help me)\\s+)*(?:${actionVerb})\\b`, "i").test(clause));
  // Users often enter personal to-dos as obligations rather than commands.
  const obligationAction = actionClauses.some((clause) => new RegExp(`\\b(?:need|have|must|should|ought)\\s+to\\s+${actionVerb}\\b`, "i").test(clause)
    && !/^\s*(?:should i|do i need to|must i)\b/i.test(clause));
  return activeProposalRefinement || explicitTaskAction || imperativeStart || obligationAction;
}

function hasNonMeetingTaskAction(prompt: string): boolean {
  const actionVerb = "(?:ask|chase|follow[ -]?up|analyse|analyze|review|investigate|call|contact|email|message|send|draft|write|present|deliver|compile|create|build|update|complete|finish|submit|share|coordinate|arrange|book|schedule|organize|organise|collect|gather|confirm|resolve|fix|implement|test|discuss|request|remind|go|attend|visit)";
  const clauses = prompt.split(/[\n.!?;]+|\bthen\b/i).map((clause) => clause.trim()).filter(Boolean);
  return clauses.some((clause) =>
    new RegExp(`^(?:(?:please|also|and|i need to|i need you to|i want to|i want you to|can you|could you|would you|help me)\\s+)*${actionVerb}\\b`, "i").test(clause)
      || new RegExp(`\\b(?:need|have|must|should|ought)\\s+to\\s+${actionVerb}\\b`, "i").test(clause));
}

// This only decides whether to ask the skill-driven router. The Orchestrator
// skill and LLM still select Lab; generic research and task prompts are not
// directly routed here.
export function labRoutingCandidate(request: OrchestratorRequest): boolean {
  const prompt = request.prompt.toLocaleLowerCase();
  const explicitLab = /\b(?:send|submit|hand\s*off|run|perform|use|create|prepare|analyse|analyze|build|make)\b[\s\S]{0,80}\b(?:to\s+)?lab\b/i.test(prompt)
    || /\blab\b[\s\S]{0,80}\b(?:request|analysis|deck|slides?|presentation|project|this|it)\b/i.test(prompt);
  const deckDeliverable = /\b(?:create|make|build|produce|draft|generate|develop)\b[\s\S]{0,80}\b(?:slides?|slide\s+deck|presentation|deck)\b/i.test(prompt)
    || /\bprepare\s+(?:(?:a|the|some)\s+)?(?:slides?|slide\s+deck|presentation|deck)\b/i.test(prompt);
  const analysisHandoff = prompt.split(/[\n.!?;]+|\bthen\b/i).some((clause) =>
    /\b(?:analyse|analyze|analysis|investigate|assess|evaluate)\b/i.test(clause)
      && /\b(?:latest|current|project|this\s+email|this\s+document|uploaded|attached|brief|using\s+(?:the\s+)?latest|from\s+(?:the\s+)?document|in\s+the\s+attached|send\s+to\s+lab|lab)\b/i.test(clause));
  const activeProposalFollowup = Boolean(request.pendingLabProposal
    && (request.pendingLabProposal.status === "proposal" || request.pendingLabProposal.status === "clarification")
    && !/^(?:what is|what are|who is|why is|why are|how does|explain)\b/i.test(prompt.trim())
    && (request.pendingLabProposal.status === "clarification" || /\b(?:change|revise|update|add|remove|make\s+it|instead|actually|focus|include|exclude|use\s+the|create|analyse|analyze)\b/i.test(prompt)));
  return explicitLab || deckDeliverable || analysisHandoff || activeProposalFollowup;
}

// Small local models can over-route ordinary questions to Meeting Agent when
// the conversation contains older meeting context. Require a clear request to
// retrieve, assess, or prepare for calendar events before using that agent.
function meetingActionIsRequested(prompt: string): boolean {
  const clauses = prompt.toLocaleLowerCase().split(/[\n.!?;]+|\bthen\b/i).map((clause) => clause.trim()).filter(Boolean);
  const meetingNoun = "(?:meeting|meetings|calendar|appointment|appointments)";
  const action = "(?:show|list|find|check|retrieve|prepare|brief|summari[sz]e|important|importance|conflict|conflicts|overlap|attend|attendees)";
  return clauses.some((text) => new RegExp(`\\b${action}\\b[\\s\\S]{0,50}\\b${meetingNoun}\\b`, "i").test(text)
    || new RegExp(`\\b${meetingNoun}\\b[\\s\\S]{0,50}\\b${action}\\b`, "i").test(text)
    || /\b(?:when|where|who)\s+(?:is|are)\s+(?:the|my|our|this|that)\s+(?:meeting|appointment)\b/i.test(text));
}

function buildAgentRequest(
  request: OrchestratorRequest,
  skillInstructions: string,
  previousAgentResults: AgentExecutionResult[],
  agent: SpecialistAgentName,
): AgentRequest {
  return {
    userPrompt: request.prompt,
    // Lab proposals are request-scoped. Its active proposal is passed separately;
    // older general chat and pending Task/Meeting state are intentionally excluded.
    conversationContext: agent === "lab" ? [] : request.conversationContext,
    skillInstructions,
    availableToolContext: previousAgentResults.flatMap((result) => result.meeting ? [result.meeting] : []),
    previousAgentResults,
    currentEmailContext: request.currentEmailContext,
    pendingTaskProposal: agent === "lab" ? null : request.pendingTaskProposal,
    pendingLabProposal: request.pendingLabProposal,
    latestMeetingResult: agent === "lab" ? undefined : request.latestMeetingResult,
    allowMockFallback: request.allowMockFallback,
  };
}

export class BrainOrchestrator {
  private readonly dependencies: OrchestratorDependencies;

  constructor(
    private readonly llm: OrchestratorLlm = assistantService,
    dependencies: Partial<OrchestratorDependencies> = {},
  ) {
    this.dependencies = {
      task: taskAgent,
      meeting: meetingAgent,
      research: generalResearchAgent,
      lab: labAgent,
      loadSkill: loadSpecialistSkill,
      ...dependencies,
    };
  }

  async process(request: OrchestratorRequest): Promise<OrchestratorResult> {
    let plan: OrchestratorPlan;
    const labCandidate = labRoutingCandidate(request);
    const meetingFollowup = Boolean(request.latestMeetingResult?.meetings.length
      && /\b(?:first|second|third|last|one|those|these)\b/i.test(request.prompt)
      && /\b(?:prepare|prep|brief|show|list|find|check|when|where|who)\b/i.test(request.prompt));
    const meetingAction = meetingActionIsRequested(request.prompt);
    const taskAction = taskActionIsRequested(request);
    const directTask = taskAction && (!meetingAction || hasNonMeetingTaskAction(request.prompt)) && !meetingFollowup && !labCandidate;
    const directResearch = !taskAction && !meetingAction && !meetingFollowup && !labCandidate;
    if (directTask) {
      // Clear standalone task requests should not be reinterpreted by the
      // router as a request to summarize or discuss the user's to-do list.
      plan = { executionMode: "sequential", steps: [{ agent: "task", requiresPreviousResult: false }], clarificationQuestions: [] };
    } else if (directResearch) {
      // Ordinary free-text questions do not need an LLM routing call. Send them
      // straight to Research so each question uses one model generation, not two.
      plan = { executionMode: "sequential", steps: [{ agent: "research", requiresPreviousResult: false }], clarificationQuestions: [] };
    } else {
      let routingSkill: string;
      try {
        routingSkill = await this.dependencies.loadSkill("orchestrator");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The Orchestrator skill could not be loaded.";
        return { status: "error", response: detail, agentResults: [], handledBy: [], errors: [detail] };
      }

      let routeReply;
      try {
        routeReply = await this.llm.chat({
          // When routing a Lab intent, do not expose stale task/meeting chat turns.
          // The active Lab proposal remains available as targeted structured state.
          history: [...(labCandidate ? [] : request.conversationContext.slice(-8)), { role: "user", content: request.prompt }],
          emailContext: request.currentEmailContext,
          systemInstructions: [
            routingSkill,
            "Relevant structured state from this conversation (use only if the current request refers to it):",
            structuredConversation(request, labCandidate),
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

      try {
        plan = validateOrchestratorPlan(parseJson(routeReply.text));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The routing plan could not be validated.";
        return { status: "error", response: detail, agentResults: [], handledBy: [], errors: [detail], provider: "local-llm" };
      }
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
        skillInstructions = await this.dependencies.loadSkill(skillFor(step.agent));
      } catch (error) {
        const detail = error instanceof Error ? error.message : `${step.agent} skill could not be loaded.`;
        return { agent: step.agent, status: "error", response: detail, errors: [detail], uiActions: [] };
      }
      const agentRequest = buildAgentRequest(request, skillInstructions, previous, step.agent);
      return this.dependencies[step.agent].execute(agentRequest);
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
    const response = responseParts.join("\n\n")
      || agentResults.flatMap((result) => [result.response, ...(result.errors ?? [])]).map((part) => part.trim()).filter(Boolean).join("\n\n")
      || (failed ? "The selected agent could not complete the request. Check the local AI connection and try again." : "I couldn't prepare a response. Please try again.");
    return {
      status,
      response,
      plan,
      agentResults,
      handledBy: [...new Set(agentResults.filter((result) => result.status !== "skipped").map((result) => result.agent))],
      provider: agentResults.some((result) => result.provider === "mock") ? "mock" : "local-llm",
      ...(errors.length ? { errors } : {}),
    };
  }
}

export const brainOrchestrator = new BrainOrchestrator();
