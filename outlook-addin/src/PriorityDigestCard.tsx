import { useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import type { PriorityDigestResult } from "./priorityDigestService";
import { mockPrepareService } from "./mockPrepareService";

type Props = {
  emailIdentity: string;
  digest: PriorityDigestResult;
};

export default function PriorityDigestCard({ emailIdentity, digest }: Props) {
  const [stage, setStage] = useState<"choose" | "preparing" | "complete" | "error">("choose");
  const [selectedMeetingId, setSelectedMeetingId] = useState(digest.meetings[0]?.meetingId ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const requestLocked = useRef(false);
  const selectedMeeting = digest.meetings.find((meeting) => meeting.meetingId === selectedMeetingId);

  async function prepare() {
    if (!selectedMeeting || requestLocked.current || stage === "complete") return;
    requestLocked.current = true;
    setStage("preparing");
    setError("");
    try {
      const result = await mockPrepareService.prepare(emailIdentity, selectedMeeting);
      setConfirmation(result.message);
      setStage("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated preparation request failed.");
      setStage("error");
      requestLocked.current = false;
    }
  }

  return <section className="priority-digest-card" aria-label="Daily Priority Digest meeting preparation">
    <p className="priority-question">I found important meetings in your Daily Priority Digest. Choose one to prepare for:</p>
    <div className="priority-meeting-list" role="radiogroup" aria-label="Choose a meeting">
      {digest.meetings.map((meeting) => <label className={`priority-meeting-option${selectedMeetingId === meeting.meetingId ? " selected" : ""}`} key={meeting.meetingId}>
        <input
          type="radio"
          name={`priority-meeting-${emailIdentity}`}
          value={meeting.meetingId}
          checked={selectedMeetingId === meeting.meetingId}
          disabled={stage === "preparing" || stage === "complete"}
          onChange={() => setSelectedMeetingId(meeting.meetingId)}
        />
        <span className="priority-meeting-details">
          <strong>{meeting.title}</strong>
          <span>{meeting.time ?? "Time not stated"}{meeting.date ? ` · ${meeting.date}` : ""}</span>
          {meeting.context && <span>{meeting.context}</span>}
        </span>
      </label>)}
    </div>
    {stage !== "complete" && <div className="priority-actions">
      <Button appearance="primary" disabled={!selectedMeeting || stage === "preparing"} onClick={() => void prepare()} className="priority-primary-action">
        {stage === "preparing" ? <><Spinner size="tiny" /> Preparing…</> : "Prepare"}
      </Button>
      {stage === "error" && <Button appearance="secondary" onClick={() => void prepare()}>Retry</Button>}
    </div>}
    {stage === "complete" && <div className="priority-confirmation" role="status">
      <strong>Simulated confirmation</strong>
      <p>{confirmation}</p>
      <span>No email, calendar, or external preparation service was used.</span>
    </div>}
    {stage === "error" && <p className="priority-error" role="alert">{error}</p>}
    <span className="priority-simulated-note">Meeting preparation is simulated only.</span>
  </section>;
}
