import type { TaskProposal } from "./taskPlanningService";
import type { ChatTurn } from "./llmService";
import type { MockAppointment } from "./mockCalendarService";

export type SpecialistAgentName = "task" | "meeting" | "research";
export type AgentExecutionStatus = "success" | "clarification" | "unavailable" | "error" | "skipped";

export type MeetingItem = MockAppointment & {
  attendees: string[];
  description: string;
};

export type MeetingAgentIntent = "list" | "importance" | "prepare" | "conflicts" | "clarification";

export type MeetingAgentData = {
  intent: MeetingAgentIntent;
  answer: string;
  scopeLabel: string;
  meetings: MeetingItem[];
  importanceRationales: Array<{ meetingId: string; rationale: string }>;
  conflicts: Array<{ meetingIds: string[]; explanation: string }>;
  simulated: true;
};

export type AgentUiAction =
  | { type: "review-task-proposal"; proposalId: string }
  | { type: "select-meeting"; meetingIds: string[] }
  | { type: "confirm-meeting-preparation"; meetingIds: string[] };

export type AgentExecutionResult = {
  agent: SpecialistAgentName;
  status: AgentExecutionStatus;
  response: string;
  provider?: "local-llm" | "mock";
  taskProposal?: TaskProposal;
  meeting?: MeetingAgentData;
  clarificationQuestions?: string[];
  uiActions: AgentUiAction[];
  errors?: string[];
};

export type AgentRequest = {
  userPrompt: string;
  conversationContext: ChatTurn[];
  skillInstructions: string;
  availableToolContext?: unknown;
  previousAgentResults: AgentExecutionResult[];
  currentEmailContext?: string;
  pendingTaskProposal?: TaskProposal | null;
  latestMeetingResult?: MeetingAgentData;
  allowMockFallback: boolean;
};

export type OrchestratorRequest = {
  prompt: string;
  conversationContext: ChatTurn[];
  currentEmailContext?: string;
  pendingTaskProposal?: TaskProposal | null;
  latestMeetingResult?: MeetingAgentData;
  allowMockFallback: boolean;
};

export type OrchestratorStep = {
  agent: SpecialistAgentName;
  requiresPreviousResult: boolean;
};

export type OrchestratorPlan = {
  executionMode: "sequential" | "independent";
  steps: OrchestratorStep[];
  clarificationQuestions: string[];
};

export type OrchestratorResult = {
  status: "success" | "partial" | "clarification" | "mock-fallback" | "unavailable" | "error";
  response: string;
  plan?: OrchestratorPlan;
  agentResults: AgentExecutionResult[];
  handledBy: SpecialistAgentName[];
  provider?: "local-llm" | "mock";
  errors?: string[];
};
