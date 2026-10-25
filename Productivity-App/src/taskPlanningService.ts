import { assistantService, type AssistantReply } from "./assistantService";
import { mockCalendarService, type MockAppointment, type MockCalendarSnapshot } from "./mockCalendarService";
import type { ChatTurn } from "./llmService";

export type ProposedSchedule = { startAt: string; endAt: string };
export type ProposedTask = {
  taskId: string;
  title: string;
  description: string;
  proposedDueDate: string | null;
  dependencies: string[];
  estimatedDurationMinutes: number | null;
  schedulingConstraints: string[];
  proposedSchedule: ProposedSchedule | null;
  schedulingConflicts: MockAppointment[];
};

export type TaskProposalStatus = "proposal" | "clarification" | "cancelled" | "created" | "superseded";
export type TaskProposal = {
  proposalId: string;
  approvalKey: string;
  status: TaskProposalStatus;
  assistantMessage: string;
  clarificationQuestions: string[];
  tasks: ProposedTask[];
  calendar: MockCalendarSnapshot;
};

export type TaskPlanningResult =
  | { kind: "task-proposal"; proposal: TaskProposal; provider: "local-llm" }
  | { kind: "chat"; text: string; provider: AssistantReply["provider"] }
  | { kind: "mock"; text: string }
  | { kind: "unavailable"; text: string }
  | { kind: "invalid"; text: string };

type ModelOutcome = "task_plan" | "task_refinement" | "clarification" | "not_task";
type ModelTask = Omit<ProposedTask, "schedulingConflicts">;
type ModelPlan = {
  outcome: ModelOutcome;
  assistantMessage: string;
  clarificationQuestions: string[];
  tasks: ModelTask[];
};

export interface TaskPlanningRequest {
  text: string;
  history: ChatTurn[];
  currentEmailContext?: string;
  pendingProposal?: TaskProposal | null;
  allowMockFallback?: boolean;
  skillInstructions?: string;
  additionalContext?: string;
}

// This schema defines the response shape only. Planning rules live in SKILL.md.
export const taskPlanResponseJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["task_plan", "task_refinement", "clarification", "not_task"] },
    assistantMessage: { type: "string" },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          proposedDueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
          dependencies: { type: "array", items: { type: "string" } },
          estimatedDurationMinutes: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          schedulingConstraints: { type: "array", items: { type: "string" } },
          proposedSchedule: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  startAt: { type: "string", format: "date-time" },
                  endAt: { type: "string", format: "date-time" },
                },
                required: ["startAt", "endAt"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["taskId", "title", "description", "proposedDueDate", "dependencies", "estimatedDurationMinutes", "schedulingConstraints", "proposedSchedule"],
        additionalProperties: false,
      },
    },
  },
  required: ["outcome", "assistantMessage", "clarificationQuestions", "tasks"],
  additionalProperties: false,
};

const planningPrompt = [
  "Apply the editable task-planning skill included below to the latest user request.",
  "The skill defines all task-identification and planning rules. Follow it; do not replace it with keyword matching or your own unstated conventions.",
  "Return JSON only using these exact types: outcome is task_plan, task_refinement, clarification, or not_task; assistantMessage is text; clarificationQuestions is an array of text; tasks is an array. Every task has taskId (text), title (text), description (text), proposedDueDate (YYYY-MM-DD text or null), dependencies (array of task ID text), estimatedDurationMinutes (positive integer or null), schedulingConstraints (array of text, use [] when none), and proposedSchedule (null or an object with ISO startAt and endAt strings). The application validates every field against its TypeScript schema.",
  "For a non-task/general request, use outcome not_task and provide a helpful ordinary chat response in assistantMessage with an empty tasks array.",
  "For a request requiring essential clarification, use outcome clarification and put concise questions in clarificationQuestions. Do not invent missing task details.",
  "For actionable work that can be proposed, use outcome task_plan. When the latest request changes an active proposal, use task_refinement and return the complete revised proposal. Use unique taskId values within this response and refer to those values in dependencies.",
  "Completeness is mandatory: account for every actionable sentence or clause in the current request, including actions after the first sentence. Related actions may share one task only when they lead to one combined outcome; never omit a later action because it supports or depends on an earlier one. Before returning JSON, check each listed clause against the tasks and add any missing action.",
  "Keep proposedDueDate separate from proposedSchedule. Use null for unknown dates, durations, or calendar slots.",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid task plan: ${field} must be text.`);
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid task plan: ${field} must be a list of text values.`);
  }
  return value;
}

function validateIsoDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid task plan: due dates must use YYYY-MM-DD or null.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid task plan: a proposed due date is not a valid calendar date.");
  }
  return value;
}

function parseSchedule(value: unknown): ProposedSchedule | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.startAt !== "string" || typeof value.endAt !== "string") {
    throw new Error("Invalid task plan: proposedSchedule must contain startAt and endAt, or be null.");
  }
  const start = Date.parse(value.startAt);
  const end = Date.parse(value.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Invalid task plan: a proposed calendar slot has invalid start or end times.");
  }
  return { startAt: value.startAt, endAt: value.endAt };
}

function parseModelPlan(value: unknown): ModelPlan {
  if (!isRecord(value)) throw new Error("Llama returned a task plan that was not a JSON object.");
  let outcome = value.outcome as ModelOutcome;
  if (outcome !== "task_plan" && outcome !== "task_refinement" && outcome !== "clarification" && outcome !== "not_task") {
    throw new Error("Invalid task plan: outcome must be task_plan, task_refinement, clarification, or not_task.");
  }
  const assistantMessage = asString(value.assistantMessage, "assistantMessage");
  const clarificationQuestions = asStringArray(value.clarificationQuestions, "clarificationQuestions");
  if (!Array.isArray(value.tasks)) throw new Error("Invalid task plan: tasks must be a list.");
  const ids = new Set<string>();
  const tasks = value.tasks.map((raw, index): ModelTask => {
    if (!isRecord(raw)) throw new Error(`Invalid task plan: task ${index + 1} must be an object.`);
    const taskId = asString(raw.taskId, `tasks[${index}].taskId`).trim();
    if (!taskId || ids.has(taskId)) throw new Error("Invalid task plan: task IDs must be unique and non-empty.");
    ids.add(taskId);
    const title = asString(raw.title, `tasks[${index}].title`).trim();
    const description = asString(raw.description, `tasks[${index}].description`).trim();
    const proposedDueDate = validateIsoDate(raw.proposedDueDate);
    // A self-dependency cannot be actionable; drop that invalid relation while
    // preserving the task as a reviewable proposal.
    const dependencies = [...new Set(asStringArray(raw.dependencies, `tasks[${index}].dependencies`).filter((dependency) => dependency !== taskId))];
    const estimatedDurationMinutes = raw.estimatedDurationMinutes;
    if (estimatedDurationMinutes !== null && (!Number.isInteger(estimatedDurationMinutes) || Number(estimatedDurationMinutes) < 1)) {
      throw new Error(`Invalid task plan: task ${taskId} duration must be a positive whole number or null.`);
    }
    const schedulingConstraints = asStringArray(raw.schedulingConstraints, `tasks[${index}].schedulingConstraints`);
    const proposedSchedule = parseSchedule(raw.proposedSchedule);
    return { taskId, title, description, proposedDueDate, dependencies, estimatedDurationMinutes: estimatedDurationMinutes as number | null, schedulingConstraints, proposedSchedule };
  });

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`Invalid task plan: dependency '${dependency}' for ${task.taskId} is missing or refers to itself.`);
      }
    }
  }
  if ((outcome === "task_plan" || outcome === "task_refinement") && tasks.length === 0) throw new Error("A task proposal outcome must contain at least one task.");
  // A small model can occasionally select clarification but omit its question.
  // Treat that malformed response as ordinary chat instead of exposing an
  // internal schema error to the user. The orchestrator separately limits when
  // this agent is eligible to run.
  if (outcome === "clarification" && clarificationQuestions.length === 0) {
    if (tasks.length === 0) outcome = "not_task";
    else clarificationQuestions.push("What task detail should I clarify before preparing this proposal?");
  }
  if (outcome === "not_task" && tasks.length > 0) throw new Error("Invalid task plan: not_task cannot include tasks.");
  return {
    outcome,
    assistantMessage: outcome === "not_task" && !assistantMessage.trim()
      ? "I couldn't identify a task action to plan from that request."
      : assistantMessage,
    clarificationQuestions: outcome === "not_task" ? [] : clarificationQuestions,
    tasks,
  };
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

const dueDateStopWords = new Set([
  "the", "and", "for", "with", "from", "that", "this", "then", "need", "have", "must", "should", "ought",
  "will", "would", "could", "can", "to", "on", "by", "before", "after", "latest", "due", "today", "tomorrow",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next", "this", "week",
  "go", "attend", "visit", "finish", "complete", "get", "make", "sure", "please", "i", "we", "you", "it",
]);

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function explicitDueDateInClause(clause: string, now: Date): string | null {
  const isoDate = clause.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoDate) {
    try { return validateIsoDate(isoDate[1]); } catch { return null; }
  }
  if (/\b(?:by\s+)?tomorrow\b/i.test(clause)) return localDateString(addDays(now, 1));
  if (/\b(?:by\s+)?today\b/i.test(clause)) return localDateString(now);

  // Resolve an explicitly stated day of the month (for example, "by the 30th")
  // deterministically instead of relying on the model to infer the calendar date.
  const dayOfMonthMatch = clause.match(/\b(?:on|by|before|due(?:\s+on)?)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (dayOfMonthMatch) {
    const dayOfMonth = Number(dayOfMonthMatch[1]);
    if (dayOfMonth >= 1 && dayOfMonth <= 31) {
      let year = now.getFullYear();
      let month = now.getMonth();
      let candidate = new Date(year, month, dayOfMonth);
      if (candidate.getDate() !== dayOfMonth) return null;
      if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        month += 1;
        candidate = new Date(year, month, dayOfMonth);
        if (candidate.getDate() !== dayOfMonth) return null;
      }
      year = candidate.getFullYear();
      return localDateString(new Date(year, candidate.getMonth(), dayOfMonth));
    }
  }

  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekdayMatch = clause.match(/\b(?:(next|this|on|by|before|due(?:\s+on)?)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!weekdayMatch) return null;
  const targetDay = weekdayNames.indexOf(weekdayMatch[2].toLocaleLowerCase());
  if (targetDay < 0) return null;
  const modifier = weekdayMatch[1]?.toLocaleLowerCase() ?? "";
  let offset = (targetDay - now.getDay() + 7) % 7;
  if (modifier.startsWith("next") && offset === 0) offset = 7;
  if (modifier === "before") offset -= 1;
  return localDateString(addDays(now, offset));
}

function significantWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !dueDateStopWords.has(word)) ?? []);
}

function applyExplicitDueDates(tasks: ModelTask[], text: string, now: Date): ModelTask[] {
  const datedClauses = text
    .split(/[\n.!?;]+|\bthen\b|,\s*and\s+/i)
    .map((clause) => ({ clause, dueDate: explicitDueDateInClause(clause, now), words: significantWords(clause) }))
    .filter((clause): clause is typeof clause & { dueDate: string } => Boolean(clause.dueDate));

  if (!datedClauses.length) return tasks;
  return tasks.map((task) => {
    const taskWords = significantWords(`${task.title} ${task.description}`);
    const matches = datedClauses.map((clause) => ({
      dueDate: clause.dueDate,
      score: [...clause.words].filter((word) => taskWords.has(word)).length,
    })).filter((match) => match.score > 0).sort((left, right) => right.score - left.score);
    // Only correct a model date when one date-bearing clause clearly matches
    // this task. Ambiguous clauses are left for user review.
    if (!matches.length || (matches[1] && matches[0].score === matches[1].score)) return task;
    return { ...task, proposedDueDate: matches[0].dueDate };
  });
}

function referenceDateMap(now: Date): Array<{ date: string; weekday: string }> {
  return Array.from({ length: 15 }, (_, index) => {
    const date = addDays(now, index);
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(date),
    };
  });
}

export async function loadTaskPlanningSkill(): Promise<string> {
  const response = await fetch("/api/task-planning/skill", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load skills/task-planning/SKILL.md (HTTP ${response.status}).`);
  const skill = (await response.text()).trim();
  if (!skill) throw new Error("skills/task-planning/SKILL.md is empty. Add planning instructions and try again.");
  return skill;
}

function parseResponseText(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("Llama's task-planning response was not valid JSON. No proposal was created. Retry or adjust the request.");
  }
}

function formatLocalDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
  }).format(new Date(value));
}

function buildSystemInstructions(skill: string, now: Date, calendar: MockCalendarSnapshot, pending?: TaskProposal | null, additionalContext?: string, requestText = ""): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const pendingData = pending ? JSON.stringify({ status: pending.status, tasks: pending.tasks, clarificationQuestions: pending.clarificationQuestions }) : "none";
  const calendarLines = [
    `Source: fictional ${calendar.source}. Timezone: ${timeZone}. Coverage: ${formatLocalDateTime(calendar.rangeStart, timeZone)} through ${formatLocalDateTime(calendar.rangeEnd, timeZone)}.`,
    "Appointments:",
    ...(calendar.appointments.length
      ? calendar.appointments.map((event) => `- ${event.title}: ${formatLocalDateTime(event.startAt, timeZone)} to ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.endAt))} (${event.location}).`)
      : ["- No appointments are supplied for this date range."]),
    "Available windows on dates that contain appointments:",
    ...(calendar.availability.filter((day) => day.busyAppointments.length > 0).map((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
      const windows = day.availableWindows.map((window) => `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(window.startAt))}-${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(window.endAt))}`).join(", ");
      return `- ${label}: ${windows || "no available work-hour window"}.`;
    }) || ["- No availability windows are supplied."]),
  ].join("\n");
  const dateWeekdayReference = referenceDateMap(now).map((entry) => `${entry.date} ${entry.weekday}`).join("; ");
  const requestClauses = requestText.split(/[\n.!?;]+|\bthen\b/i).map((clause) => clause.trim()).filter(Boolean).slice(0, 12).map((clause) => clause.slice(0, 500));
  return [
    "<editable_task_planning_skill>", skill, "</editable_task_planning_skill>",
    `Reference current date and time: ${now.toISOString()}. Local representation: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "long", timeZone }).format(now)}. User timezone: ${timeZone}.`,
    `Local date-to-weekday reference for relative date interpretation: ${dateWeekdayReference}`,
    "Calendar data from MockCalendarService:",
    calendarLines,
    `Current pending proposal, if any: ${pendingData}`,
    ...(requestClauses.length ? [`Current request clauses, in order. Every actionable clause must be represented in the task list:\n${requestClauses.map((clause, index) => `${index + 1}. ${clause}`).join("\n")}`] : []),
    ...(additionalContext ? ["Structured context from a preceding specialist agent (use only when relevant to the current request):", additionalContext] : []),
    planningPrompt,
  ].join("\n\n");
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class TaskPlanningService {
  async process(request: TaskPlanningRequest): Promise<TaskPlanningResult> {
    let skill: string;
    try {
      skill = request.skillInstructions?.trim() || await loadTaskPlanningSkill();
    } catch (error) {
      return { kind: "invalid", text: error instanceof Error ? error.message : "Task planning instructions could not be loaded." };
    }

    const now = new Date();
    const rangeEnd = addDays(now, 30);
    const calendar = await mockCalendarService.getSnapshot(now, rangeEnd);
    const systemInstructions = buildSystemInstructions(skill, now, calendar, request.pendingProposal, request.additionalContext, request.text);
    const history = [
      ...request.history.slice(-6).map((turn) => ({ ...turn, content: turn.content.slice(-2_000) })),
      { role: "user" as const, content: request.text },
    ];

    let reply: AssistantReply;
    try {
      reply = await assistantService.chat({
        history,
        emailContext: request.currentEmailContext,
        systemInstructions,
        responseFormat: taskPlanResponseJsonSchema,
        timeoutMs: 300_000,
        maxOutputTokens: 700,
        contextWindow: 8192,
        temperature: 0,
        allowMockFallback: request.allowMockFallback ?? true,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The local LLM request failed.";
      return { kind: "unavailable", text: `Local AI is currently unavailable. Please check that Ollama is running. No task proposal was created. ${detail}` };
    }

    if (reply.provider === "mock") {
      return {
        kind: "mock",
        text: `${reply.text}\n\nTask planning needs Llama. This is a simulated Mock Response, not a task plan, and no tasks were created. Use Retry when local AI is available.`,
      };
    }

    let plan: ModelPlan;
    try {
      plan = parseModelPlan(parseResponseText(reply.text));
    } catch (error) {
      return { kind: "invalid", text: error instanceof Error ? error.message : "Llama returned a task plan that could not be validated. No proposal was created." };
    }

    if (plan.outcome === "not_task") {
      return { kind: "chat", text: plan.assistantMessage || "How can I help?", provider: "local-llm" };
    }

    const groundedTasks = applyExplicitDueDates(plan.tasks, request.text, now);
    const tasks: ProposedTask[] = groundedTasks.map((task) => ({
      ...task,
      schedulingConflicts: task.proposedSchedule
        ? mockCalendarService.findConflicts(task.proposedSchedule.startAt, task.proposedSchedule.endAt, calendar.appointments)
        : [],
    }));
    const proposal: TaskProposal = {
      proposalId: makeId("proposal"),
      approvalKey: makeId("approval"),
      status: plan.outcome === "clarification" ? "clarification" : "proposal",
      assistantMessage: plan.assistantMessage,
      clarificationQuestions: plan.clarificationQuestions,
      tasks,
      calendar,
    };
    return { kind: "task-proposal", proposal, provider: "local-llm" };
  }
}

export const taskPlanningService = new TaskPlanningService();

export function validateProposalForApproval(proposal: TaskProposal): string[] {
  const issues: string[] = [];
  if (proposal.status !== "proposal") issues.push("Resolve the clarification questions before approving this proposal.");
  if (proposal.tasks.length === 0) issues.push("Add at least one task before approving.");
  const ids = new Set(proposal.tasks.map((task) => task.taskId));
  for (const task of proposal.tasks) {
    if (!task.title.trim()) issues.push(`${task.taskId}: add a title.`);
    if (!task.description.trim()) issues.push(`${task.taskId}: add a description.`);
    if (task.proposedDueDate !== null) {
      try { validateIsoDate(task.proposedDueDate); }
      catch { issues.push(`${task.taskId}: enter a valid due date.`); }
    }
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency) || dependency === task.taskId) issues.push(`${task.taskId}: dependency ${dependency} is invalid.`);
    }
    if (task.proposedSchedule) {
      const start = Date.parse(task.proposedSchedule.startAt);
      const end = Date.parse(task.proposedSchedule.endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) issues.push(`${task.taskId}: proposed schedule is invalid.`);
    }
  }
  return issues;
}
