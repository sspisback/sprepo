import type { KnowledgeSourceReference } from "./agentContracts";

export type LabActionType = "analysis" | "slide_deck";
export type LabProposalStatus = "proposal" | "clarification" | "cancelled" | "submitted" | "superseded";

export type MockLabSubmission = {
  requestId: string;
  jobId: string;
  actionType: LabActionType;
  clientProject: string;
  prompt: string;
  sources: KnowledgeSourceReference[];
  submittedAt: string;
  status: "submitted";
  resultUrl: string;
  simulated: true;
};

export type LabProposal = {
  proposalId: string;
  status: LabProposalStatus;
  actionType: LabActionType | null;
  originalRequest: string;
  clientProject: string;
  prompt: string;
  clarificationQuestions: string[];
  sources: KnowledgeSourceReference[];
  requiresRegeneration?: boolean;
  submission?: MockLabSubmission;
};
