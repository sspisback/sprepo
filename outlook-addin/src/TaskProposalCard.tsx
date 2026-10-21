import { useMemo, useState } from "react";
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

function dateTimeInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const two = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function inputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function TaskProposalCard({ proposal, creating, creationResult, onUpdateTask, onAddTask, onRemoveTask, onApprove, onCancel }: Props) {
  const issues = useMemo(() => validateProposalForApproval(proposal), [proposal]);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, { start: string; end: string }>>({});
  const editable = proposal.status === "proposal" && !creationResult;
  const calendarEvents = proposal.calendar.appointments;

  function editSchedule(task: ProposedTask, field: "start" | "end", value: string) {
    const existing = scheduleDrafts[task.taskId] ?? {
      start: dateTimeInput(task.proposedSchedule?.startAt),
      end: dateTimeInput(task.proposedSchedule?.endAt),
    };
    const draft = { ...existing, [field]: value };
    setScheduleDrafts((current) => ({ ...current, [task.taskId]: draft }));
    const startAt = inputToIso(draft.start);
    const endAt = inputToIso(draft.end);
    if (startAt && endAt) onUpdateTask(task.taskId, { proposedSchedule: { startAt, endAt } });
    else if (!value && task.proposedSchedule) onUpdateTask(task.taskId, { proposedSchedule: null });
  }

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
        <span className="task-id">{task.taskId}</span>
        {editable && <Button appearance="subtle" size="small" onClick={() => onRemoveTask(task.taskId)}>Remove</Button>}
      </div>
      <label>Title
        <input value={task.title} disabled={!editable} maxLength={180} onChange={(event) => onUpdateTask(task.taskId, { title: event.currentTarget.value })} />
      </label>
      <label>Description
        <textarea value={task.description} disabled={!editable} rows={3} maxLength={1600} onChange={(event) => onUpdateTask(task.taskId, { description: event.currentTarget.value })} />
      </label>
      <label>Proposed due date
        <input type="date" value={task.proposedDueDate ?? ""} disabled={!editable} onChange={(event) => onUpdateTask(task.taskId, { proposedDueDate: event.currentTarget.value || null })} />
      </label>
      <label>Dependencies (task IDs, comma separated)
        <input value={task.dependencies.join(", ")} disabled={!editable} onChange={(event) => onUpdateTask(task.taskId, { dependencies: event.currentTarget.value.split(",").map((part) => part.trim()).filter(Boolean) })} />
      </label>
      <label>Estimated duration in minutes
        <input type="number" min={1} step={5} value={task.estimatedDurationMinutes ?? ""} disabled={!editable} onChange={(event) => onUpdateTask(task.taskId, { estimatedDurationMinutes: event.currentTarget.value ? Number(event.currentTarget.value) : null })} />
      </label>
      <label>Scheduling constraints
        <textarea value={task.schedulingConstraints.join("\n")} disabled={!editable} rows={2} maxLength={800} onChange={(event) => onUpdateTask(task.taskId, { schedulingConstraints: event.currentTarget.value.split("\n").map((part) => part.trim()).filter(Boolean) })} />
      </label>
      <details className="task-schedule-editor">
        <summary>{task.proposedSchedule ? "Proposed calendar slot" : "Add a calendar slot (optional)"}</summary>
        <label>Start
          <input type="datetime-local" disabled={!editable} value={scheduleDrafts[task.taskId]?.start ?? dateTimeInput(task.proposedSchedule?.startAt)} onChange={(event) => editSchedule(task, "start", event.currentTarget.value)} />
        </label>
        <label>End
          <input type="datetime-local" disabled={!editable} value={scheduleDrafts[task.taskId]?.end ?? dateTimeInput(task.proposedSchedule?.endAt)} onChange={(event) => editSchedule(task, "end", event.currentTarget.value)} />
        </label>
      </details>
      {task.proposedSchedule ? task.schedulingConflicts.length > 0
        ? <div className="task-conflict conflict"><strong>Calendar conflict</strong><ul>{task.schedulingConflicts.map((event) => <li key={event.id}>{event.title}: {new Date(event.startAt).toLocaleString()} – {new Date(event.endAt).toLocaleTimeString()}</li>)}</ul></div>
        : <div className="task-conflict clear">No conflicts with the supplied mock appointments.</div>
        : <div className="task-conflict">No time slot proposed. A due date is a deadline, not a calendar booking.</div>}
    </article>)}

    {calendarEvents.length > 0 && <details className="mock-calendar-events">
      <summary>Mock Calendar data used ({calendarEvents.length})</summary>
      <ul>{calendarEvents.map((event) => <li key={event.id}><strong>{event.title}</strong> · {new Date(event.startAt).toLocaleString()}–{new Date(event.endAt).toLocaleTimeString()}</li>)}</ul>
    </details>}

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

