import { Button } from "@fluentui/react-components";
import type { LabProposal } from "./labTypes";

type Props = {
  proposal: LabProposal;
  submitting: boolean;
  feedback?: string;
  onPromptChange: (value: string) => void;
  onRegenerate: () => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export default function LabProposalCard(props: Props) {
  const { proposal, submitting } = props;
  const editable = proposal.status === "proposal";
  const isDeck = proposal.actionType === "slide_deck";
  const cta = isDeck ? "Create slides in Lab" : "Analyse in Lab";
  return <section className="lab-proposal" aria-label="Lab request proposal">
    <div className="lab-proposal-heading"><strong>{proposal.status === "submitted" ? "Submitted to simulated Lab" : proposal.status === "cancelled" ? "Lab proposal cancelled" : proposal.status === "clarification" ? "Clarification needed" : "Review Lab request"}</strong><span>LOCAL SIMULATION</span></div>
    {proposal.clarificationQuestions.length > 0 && <div className="lab-questions"><strong>Brain needs to know</strong><ul>{proposal.clarificationQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul><small>Reply in the chat with the missing information.</small></div>}
    <label>Prompt for Lab<textarea disabled={!editable} value={proposal.prompt} rows={7} maxLength={6000} onChange={(event) => props.onPromptChange(event.currentTarget.value)} placeholder="Review and edit the proposed request" /></label>
    {proposal.requiresRegeneration && <p className="lab-feedback" role="status">The action, project, or sources changed. Regenerate the prompt before submitting.</p>}
    {props.feedback && <p className="lab-feedback" role="status">{props.feedback}</p>}
    {editable && <div className="lab-actions"><Button appearance="secondary" disabled={submitting} onClick={props.onRegenerate}>Regenerate prompt</Button><Button appearance="primary" disabled={submitting || proposal.status !== "proposal" || proposal.requiresRegeneration || !proposal.prompt.trim()} onClick={props.onSubmit}>{submitting ? "Submitting…" : cta}</Button><Button appearance="subtle" disabled={submitting} onClick={props.onCancel}>Cancel</Button></div>}
    {proposal.submission && <div className="lab-submission" role="status"><strong>Status: Submitted</strong><span>Job ID: {proposal.submission.jobId}</span><a href={proposal.submission.resultUrl}>View local simulated result</a><small>This is a simulated handoff. No real Lab service was contacted and no work was performed.</small></div>}
    <p className="lab-disclaimer">Nothing is submitted until you approve the action-specific button. The handoff is local and simulated.</p>
  </section>;
}
