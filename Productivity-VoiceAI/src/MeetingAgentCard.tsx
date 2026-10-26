import { useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import type { MeetingAgentData, MeetingItem } from "./agentContracts";
import { mockPrepareService } from "./mockPrepareService";

function formatMeetingTime(meeting: MeetingItem): string {
  const start = new Date(meeting.startAt);
  const end = new Date(meeting.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return `${meeting.startAt}–${meeting.endAt}`;
  return `${start.toLocaleDateString()} · ${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function MeetingDetails({ meeting, rationale }: { meeting: MeetingItem; rationale?: string }) {
  return <div className="meeting-result-details">
    <strong>{meeting.title}{meeting.eventType === "appointment" ? " · appointment" : ""}</strong>
    <span>{formatMeetingTime(meeting)}</span>
    {meeting.attendees.length > 0 && <span>With {meeting.attendees.join(", ")}</span>}
    {meeting.location && <span>{meeting.location}</span>}
    {meeting.description && <span>{meeting.description}</span>}
    {rationale && <span className="meeting-importance-rationale">Why it may matter: {rationale}</span>}
  </div>;
}

export default function MeetingAgentCard({ data }: { data: MeetingAgentData }) {
  const [selectedMeetingId, setSelectedMeetingId] = useState(data.meetings[0]?.id ?? "");
  const [preparations, setPreparations] = useState<Record<string, { stage: "preparing" | "complete" | "error"; message: string }>>({});
  const requestLocks = useRef(new Set<string>());
  const selected = data.meetings.find((meeting) => meeting.id === selectedMeetingId);

  async function prepareMeeting(meeting: MeetingItem) {
    const current = preparations[meeting.id];
    if (requestLocks.current.has(meeting.id) || current?.stage === "complete") return;
    requestLocks.current.add(meeting.id);
    setPreparations((items) => ({ ...items, [meeting.id]: { stage: "preparing", message: "" } }));
    try {
      const result = await mockPrepareService.prepareForMeeting(`mock-meeting:${meeting.id}`, meeting);
      setPreparations((items) => ({ ...items, [meeting.id]: { stage: "complete", message: result.message } }));
    } catch (caught) {
      setPreparations((items) => ({ ...items, [meeting.id]: { stage: "error", message: caught instanceof Error ? caught.message : "The simulated meeting preparation failed." } }));
    } finally {
      requestLocks.current.delete(meeting.id);
    }
  }

  const rationaleById = new Map(data.importanceRationales.map((item) => [item.meetingId, item.rationale]));
  const meetingsById = new Map(data.meetings.map((meeting) => [meeting.id, meeting]));

  return <section className="meeting-agent-card" aria-label="Simulated calendar result">
    <span className="meeting-simulated-label">SIMULATED CALENDAR</span>
    {data.intent === "clarification" && <p>{data.answer || "Please clarify which meeting you mean."}</p>}
    {data.meetings.length === 0 && data.conflicts.length === 0 && data.intent !== "clarification" && data.intent !== "importance" && <p>{data.intent === "conflicts" ? "No scheduling conflicts were found in the simulated calendar range." : "No matching meetings were found in the simulated calendar."}</p>}

    {data.intent === "conflicts" && data.conflicts.length > 0 && <div className="meeting-conflict-list">
      {data.conflicts.map((conflict, index) => <div className="meeting-conflict" key={`${index}-${conflict.meetingIds.join("-")}`}>
        {conflict.meetingIds.map((id) => meetingsById.get(id)).filter((meeting): meeting is MeetingItem => Boolean(meeting)).map((meeting) => <MeetingDetails key={meeting.id} meeting={meeting} />)}
        <p>{conflict.explanation}</p>
      </div>)}
    </div>}

    {data.intent !== "prepare" && data.intent !== "clarification" && data.intent !== "conflicts" && data.meetings.length > 0 && <div className="meeting-result-list">
      {data.meetings.map((meeting) => {
        const preparation = preparations[meeting.id];
        return <article className="meeting-result-option" key={meeting.id}>
          <MeetingDetails meeting={meeting} rationale={rationaleById.get(meeting.id)} />
          <div className="meeting-agent-actions">
            <Button appearance="primary" disabled={preparation?.stage === "preparing" || preparation?.stage === "complete"} onClick={() => void prepareMeeting(meeting)}>
              {preparation?.stage === "preparing" ? <><Spinner size="tiny" /> Preparing…</> : preparation?.stage === "complete" ? "Prepared" : preparation?.stage === "error" ? "Retry Prepare" : "Prepare"}
            </Button>
          </div>
          {preparation?.stage === "complete" && <div className="meeting-agent-confirmation" role="status"><strong>Simulated confirmation</strong><p>{preparation.message}</p></div>}
          {preparation?.stage === "error" && <p className="meeting-agent-error" role="alert">{preparation.message}</p>}
        </article>;
      })}
    </div>}

    {data.intent === "prepare" && data.meetings.length > 0 && <>
      <p className="meeting-prepare-question">Select a meeting, then confirm with Prepare.</p>
      <div className="meeting-result-list" role="radiogroup" aria-label="Select a meeting to prepare for">
        {data.meetings.map((meeting) => <label className={`meeting-result-option meeting-select-option${selectedMeetingId === meeting.id ? " selected" : ""}`} key={meeting.id}>
          <input type="radio" name="meeting-agent-prepare" value={meeting.id} checked={selectedMeetingId === meeting.id} disabled={preparations[meeting.id]?.stage === "preparing" || preparations[meeting.id]?.stage === "complete"} onChange={() => setSelectedMeetingId(meeting.id)} />
          <MeetingDetails meeting={meeting} />
        </label>)}
      </div>
      {selected && preparations[selected.id]?.stage !== "complete" && <div className="meeting-agent-actions">
        <Button appearance="primary" disabled={!selected || preparations[selected.id]?.stage === "preparing"} onClick={() => selected && void prepareMeeting(selected)}>
          {preparations[selected?.id ?? ""]?.stage === "preparing" ? <><Spinner size="tiny" /> Preparing…</> : preparations[selected?.id ?? ""]?.stage === "error" ? "Retry Prepare" : "Prepare"}
        </Button>
      </div>}
      {selected && preparations[selected.id]?.stage === "complete" && <div className="meeting-agent-confirmation" role="status"><strong>Simulated confirmation</strong><p>{preparations[selected.id].message}</p></div>}
      {selected && preparations[selected.id]?.stage === "error" && <p className="meeting-agent-error" role="alert">{preparations[selected.id].message}</p>}
    </>}
    {data.intent !== "prepare" && data.answer && data.intent !== "clarification" && <p className="meeting-agent-answer">{data.answer}</p>}
    <span className="meeting-agent-disclaimer">Fictional data only. No Outlook calendar, email, or external preparation service was used.</span>
  </section>;
}
