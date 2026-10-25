import { useMemo } from "react";
import { Button } from "@fluentui/react-components";
import { validateProposalForApproval, type ProposedTask, type TaskProposal } from "./taskPlanningService";

type Props = {
  proposal: TaskProposal;
  creating: boolean;
  creationResult?: string;
  onUpdateTask: (taskId: string, patch: Partial<ProposedTask>) => void;
  onAddTask: () => void;
  onRemoveTask: (taskId: string) => void;
  onApprove: () => void;
  onCancel: () => void;
};

export default function TaskProposalCard({ proposal, creating, creationResult, onUpdateTask, onAddTask, onRemoveTask, onApprove, onCancel }: Props) {
  const issues = useMemo(() => validateProposalForApproval(proposal), [proposal]);
  const editable = proposal.status === "proposal" && !creationResult;

  return <section className={`task-proposal ${proposal.status}`} aria-label="Task proposal">
    <div className="task-proposal-heading">
      <div>
        <strong>{proposal.status === "clarification" ? "Clarification needed" : proposal.status === "created" ? "Created in Mock Planner" : proposal.status === "cancelled" ? "Proposal cancelled" : proposal.status === "superseded" ? "Updated proposal below" : "Proposed tasks"}</strong>
        <span className="mock-planner-label">Mock Calendar · Mock Planner</span>
      </div>
    </div>
    {proposal.assistantMessage && <p className="task-proposal-intro">{proposal.assistantMessage}</p>}

    {proposal.clarificationQuestions.length > 0 && <div className="task-questions">
      <strong>Brain needs to know</strong>
      <ul>{proposal.clarificationQuestions.map((question, index) => <li key={`${proposal.proposalId}-q-${index}`}>{question}</li>)}</ul>
      <span>Reply in the chat to refine the plan. No tasks have been created.</span>
    </div>}

    {proposal.tasks.map((task) => <article className="task-card" key={`${proposal.proposalId}-${task.taskId}`}>
      <div className="task-card-title-row">
        {editable && <Button appearance="subtle" size="small" onClick={() => onRemoveTask(task.taskId)}>Remove</Button>}
      </div>
      <label>Task Name
        <input value={task.title} disabled={!editable} maxLength={180} onChange={(event) => onUpdateTask(task.taskId, { title: event.currentTarget.value })} />
      </label>
      <label>Description
        <textarea value={task.description} disabled={!editable} rows={3} maxLength={1600} onChange={(event) => onUpdateTask(task.taskId, { description: event.currentTarget.value })} />
      </label>
      <label>Due date
        <input type="date" value={task.proposedDueDate ?? ""} disabled={!editable} onChange={(event) => onUpdateTask(task.taskId, { proposedDueDate: event.currentTarget.value || null })} />
      </label>
    </article>)}

    {editable && <div className="task-proposal-actions">
      <Button appearance="secondary" onClick={onAddTask}>Add task</Button>
      <Button appearance="primary" disabled={creating || issues.length > 0} onClick={onApprove}>{creating ? "Creating…" : "Approve & Create Tasks"}</Button>
      <Button appearance="subtle" disabled={creating} onClick={onCancel}>Cancel</Button>
    </div>}
    {editable && issues.length > 0 && <div className="task-validation" role="status">{issues.slice(0, 3).join(" ")}</div>}
    {creating && <div className="task-creation-progress" role="status">Creating simulated tasks in Mock Planner…</div>}
    {creationResult && <div className="task-creation-result" role="status">{creationResult}</div>}
    <p className="task-proposal-disclaimer">Simulated only. No real Calendar or Planner service is connected. Nothing is created before approval.</p>
  </section>;
}

