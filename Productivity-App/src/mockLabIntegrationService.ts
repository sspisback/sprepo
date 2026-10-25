import type { KnowledgeSourceReference } from "./agentContracts";
import type { LabActionType, MockLabSubmission } from "./labTypes";

export type MockLabRequest = {
  requestId: string;
  prompt: string;
  actionType: LabActionType;
  clientProject: string;
  sources: KnowledgeSourceReference[];
};

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export class MockLabIntegrationService {
  private readonly completed = new Map<string, MockLabSubmission>();
  private readonly inFlight = new Map<string, Promise<MockLabSubmission>>();

  submit(request: MockLabRequest): Promise<MockLabSubmission> {
    if (!request.requestId.trim()) return Promise.reject(new Error("A Lab request ID is required."));
    if (!request.prompt.trim()) return Promise.reject(new Error("Add a prompt before submitting to Lab."));
    if (request.actionType !== "analysis" && request.actionType !== "slide_deck") return Promise.reject(new Error("Choose an analysis or slide deck action."));
    const existing = this.completed.get(request.requestId);
    if (existing) return Promise.resolve(existing);
    const current = this.inFlight.get(request.requestId);
    if (current) return current;

    const submission = (async () => {
      await delay(650);
      const jobId = `mock-lab-${crypto.randomUUID()}`;
      const record: MockLabSubmission = {
        requestId: request.requestId,
        jobId,
        actionType: request.actionType,
        clientProject: request.clientProject.trim(),
        prompt: request.prompt.trim(),
        sources: request.sources,
        submittedAt: new Date().toISOString(),
        status: "submitted",
        resultUrl: `${window.location.origin}/#lab-result/${encodeURIComponent(jobId)}`,
        simulated: true,
      };
      this.completed.set(request.requestId, record);
      return record;
    })();
    this.inFlight.set(request.requestId, submission);
    void submission.finally(() => this.inFlight.delete(request.requestId));
    return submission;
  }
}

export const mockLabIntegrationService = new MockLabIntegrationService();
