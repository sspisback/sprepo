import type { AgentExecutionResult, AgentRequest } from "./agentContracts";
import { taskPlanningService } from "./taskPlanningService";

export class TaskAgent {
  async execute(request: AgentRequest): Promise<AgentExecutionResult> {
    const precedingResults = request.previousAgentResults.filter((result) => result.status === "success").map((result) => ({
      agent: result.agent,
      response: result.response,
      structuredResult: result.meeting ?? result.taskProposal ?? null,
    }));
    const additionalContext = precedingResults.length ? JSON.stringify(precedingResults) : undefined;
    const result = await taskPlanningService.process({
      text: request.userPrompt,
      history: request.conversationContext,
      currentEmailContext: request.currentEmailContext,
      pendingProposal: request.pendingTaskProposal,
      allowMockFallback: request.allowMockFallback,
      skillInstructions: request.skillInstructions,
      additionalContext,
    });

    if (result.kind === "task-proposal") {
      const proposal = result.proposal.status === "proposal"
        && /\b(created|booked|sent|scheduled|submitted|completed)\b/i.test(result.proposal.assistantMessage)
        ? { ...result.proposal, assistantMessage: "Here is a task proposal for your review. No tasks have been created." }
        : result.proposal;
      return {
        agent: "task",
        status: proposal.status === "clarification" ? "clarification" : "success",
        response: proposal.assistantMessage || "Here is a task proposal for your review.",
        provider: result.provider,
        taskProposal: proposal,
        clarificationQuestions: proposal.clarificationQuestions,
        uiActions: [{ type: "review-task-proposal", proposalId: proposal.proposalId }],
      };
    }
    if (result.kind === "chat") {
      return { agent: "task", status: "success", response: result.text, provider: result.provider, uiActions: [] };
    }
    if (result.kind === "mock") {
      return { agent: "task", status: "success", response: result.text, provider: "mock", uiActions: [] };
    }
    if (result.kind === "unavailable") {
      return { agent: "task", status: "unavailable", response: result.text, errors: [result.text], uiActions: [] };
    }
    return { agent: "task", status: "error", response: result.text, errors: [result.text], uiActions: [] };
  }
}

export const taskAgent = new TaskAgent();
