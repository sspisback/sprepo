import { assistantService } from "./assistantService";
import type { AgentExecutionResult, AgentRequest } from "./agentContracts";

export class GeneralResearchAgent {
  async execute(request: AgentRequest): Promise<AgentExecutionResult> {
    try {
      const reply = await assistantService.chat({
        history: [...request.conversationContext.slice(-8), { role: "user", content: request.userPrompt }],
        emailContext: request.currentEmailContext,
        systemInstructions: request.skillInstructions,
        timeoutMs: 180_000,
        maxOutputTokens: 900,
        contextWindow: 8192,
        temperature: 0.2,
        allowMockFallback: request.allowMockFallback,
      });
      return {
        agent: "research",
        status: "success",
        response: reply.text,
        provider: reply.provider,
        uiActions: [],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The local research request failed.";
      return {
        agent: "research",
        status: "unavailable",
        response: `Local AI is currently unavailable. No research answer was generated. ${detail}`,
        provider: undefined,
        errors: [detail],
        uiActions: [],
      };
    }
  }
}

export const generalResearchAgent = new GeneralResearchAgent();
