import { getMockResponse } from "./mockAssistant";
import { LocalOllamaService, type ChatTurn, type LlmChatOptions, type LlmService } from "./llmService";

export type AssistantProvider = "local-llm" | "mock";
export type AssistantReply = { text: string; provider: AssistantProvider };
export type AssistantRequest = {
  history: ChatTurn[];
  emailContext?: string;
  allowMockFallback?: boolean;
  systemInstructions?: string;
  responseFormat?: LlmChatOptions["responseFormat"];
  timeoutMs?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  temperature?: number;
};

export interface AssistantService {
  chat(request: AssistantRequest): Promise<AssistantReply>;
  checkAvailability(): Promise<void>;
}

export class MockService {
  async chat(history: ChatTurn[]): Promise<string> {
    const latestUserMessage = [...history].reverse().find((turn) => turn.role === "user")?.content ?? "";
    return getMockResponse(latestUserMessage);
  }
}

export class OllamaAssistantService implements AssistantService {
  constructor(
    private readonly ollama: LlmService = new LocalOllamaService(),
    private readonly mock: MockService = new MockService(),
  ) {}

  async chat(request: AssistantRequest): Promise<AssistantReply> {
    try {
      const text = await this.ollama.chat(request.history, request.emailContext, {
        systemInstructions: request.systemInstructions,
        responseFormat: request.responseFormat,
        timeoutMs: request.timeoutMs,
        maxOutputTokens: request.maxOutputTokens,
        contextWindow: request.contextWindow,
        temperature: request.temperature,
      });
      return { text, provider: "local-llm" };
    } catch (error) {
      if (!request.allowMockFallback) throw error;
      const mockText = await this.mock.chat(request.history);
      return {
        text: `Local AI is currently unavailable. Please check that Ollama is running.\n\n${mockText}`,
        provider: "mock",
      };
    }
  }

  checkAvailability(): Promise<void> {
    return this.ollama.checkAvailability();
  }
}

export const assistantService: AssistantService = new OllamaAssistantService();
