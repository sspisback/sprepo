import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowUp20Filled, BrainCircuit20Regular, ChatAdd20Regular, Sparkle20Filled } from "@fluentui/react-icons";
import { createEmailService, detectAddinMode, getCurrentEmailIdentity, getMockEmailOptions, getSelectedMockEmailId, selectMockEmail, type AddinMode, type EmailData } from "./emailService";
import { loadEmailSummarySkill, summariseEmailBody } from "./emailSummaryService";
import { assistantService } from "./assistantService";
import { brainOrchestrator } from "./orchestratorService";
import MeetingAgentCard from "./MeetingAgentCard";
import type { MeetingAgentData, SpecialistAgentName } from "./agentContracts";
import { isPriorityDigest } from "./priorityDigestDetector";
import { priorityDigestService, type PriorityDigestResult } from "./priorityDigestService";
import PriorityDigestCard from "./PriorityDigestCard";
import { mockCalendarService } from "./mockCalendarService";
import { mockPlannerService } from "./mockPlannerService";
import TaskProposalCard from "./TaskProposalCard";
import { validateProposalForApproval, type ProposedTask, type TaskProposal } from "./taskPlanningService";
import type { ChatTurn } from "./llmService";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  email?: EmailData;
  summary?: string;
  source?: "mock" | "local-llm" | "error";
  taskProposal?: TaskProposal;
  meetingResult?: MeetingAgentData;
  handledBy?: SpecialistAgentName[];
  isCreatingTasks?: boolean;
  proposalFeedback?: string;
  plannerResult?: string;
};
type AiStatus = "checking" | "connected" | "unavailable";
type EmailContext = { identity: string; email: EmailData };
type SavedConversation = { version: 1; messages: Message[] };
type PriorityWorkflowState =
  | { status: "checking"; identity: string }
  | { status: "ready" | "none"; identity: string; result: PriorityDigestResult }
  | { status: "error"; identity: string; error: string };
const conversationStorageKey = "brain-assistant.conversation.v1";
const welcome = "Hi! I'm Brain. How can I help you today?";
const unavailableMessage = "Local AI is currently unavailable. Please check that Ollama is running.";

function restoreConversation(): Message[] {
  try {
    const stored = window.localStorage.getItem(conversationStorageKey);
    if (!stored) return [];
    const saved = JSON.parse(stored) as SavedConversation;
    if (saved.version !== 1 || !Array.isArray(saved.messages)) return [];
    return saved.messages.filter((message): message is Message => Boolean(
      message && typeof message.id === "number" &&
      (message.role === "assistant" || message.role === "user") &&
      typeof message.text === "string"
    )).map((message) => ({ ...message, isCreatingTasks: false }));
  } catch {
    return [];
  }
}

function questionNeedsEmail(text: string): boolean {
  return /\b(reply|respond|say back|write back|answer them)\b|\b(sender|subject|deadline|action item|their request)\b|\b(this|that|current|open|previous|above)\s+(email|message)\b|\b(what did|what does|what are).{0,30}\b(email|message|they|sender)\b/i.test(text);
}

function isEmailDependent(text: string, emailContextUsed: boolean): boolean {
  if (emailContextUsed) return true;
  return /\b(summary|summari[sz]e|recap)\b.{0,35}\b(email|message)\b|\b(email|message)\b.{0,35}\b(summary|summari[sz]e|recap|content|body)\b|\b(current|open|this|that|previous)\s+(email|message)\b|\b(what should i|how do i|can you help me)\s+(reply|respond)\b|\b(reply|respond|write back|say back)\s+to\s+(it|them|this|that|the sender|the email|the message)\b|\b(sender|subject|attachment|deadline|action item|their request)\b/i.test(text);
}

function getHistory(messages: Message[]): ChatTurn[] {
  return messages.flatMap((message): ChatTurn[] => {
    if (message.role === "user") return [{ role: "user", content: message.text }];
    const content = [
      message.summary || message.text,
      message.taskProposal ? `Structured task proposal: ${JSON.stringify({ status: message.taskProposal.status, tasks: message.taskProposal.tasks, clarificationQuestions: message.taskProposal.clarificationQuestions })}` : "",
      message.meetingResult ? `Structured meeting result: ${JSON.stringify(message.meetingResult)}` : "",
    ].filter(Boolean).join("\n");
    return content && message.source !== "error" ? [{ role: "assistant", content }] : [];
  });
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>(restoreConversation);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [historyStorageAvailable, setHistoryStorageAvailable] = useState(true);
  const [mode, setMode] = useState<AddinMode>("detecting");
  const [mockEmailId, setMockEmailId] = useState(getSelectedMockEmailId);
  const [priorityWorkflow, setPriorityWorkflow] = useState<PriorityWorkflowState | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>("checking");
  const [checkingAi, setCheckingAi] = useState(false);
  const nextId = useRef(messages.reduce((highest, message) => Math.max(highest, message.id), -1) + 1);
  const turnId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const emailContext = useRef<EmailContext | null>(null);
  const pendingProposal = useRef<TaskProposal | null>(
    [...messages].reverse().find((message) => message.taskProposal &&
      (message.taskProposal.status === "proposal" || message.taskProposal.status === "clarification"))?.taskProposal ?? null,
  );
  const approvalLocks = useRef(new Set<string>());
  const priorityDigestCache = useRef(new Map<string, PriorityDigestResult>());
  const priorityDigestRequests = useRef(new Set<string>());
  const priorityInspectionSequence = useRef(0);

  useEffect(() => {
    try {
      if (messages.length === 0) {
        window.localStorage.removeItem(conversationStorageKey);
        setHistoryStorageAvailable(true);
        return;
      }
      const saved: SavedConversation = {
        version: 1,
        messages: messages.map((message) => ({ ...message, isCreatingTasks: false })),
      };
      window.localStorage.setItem(conversationStorageKey, JSON.stringify(saved));
      setHistoryStorageAvailable(true);
    } catch {
      // Keep the current chat usable if local storage is blocked or full.
      setHistoryStorageAvailable(false);
    }
  }, [messages]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    let active = true;
    void detectAddinMode().then((detectedMode) => {
      if (active) setMode(detectedMode);
    });
    return () => { active = false; };
  }, []);

  const checkAi = useCallback(async (quiet = false) => {
    if (!quiet) setCheckingAi(true);
    try {
      await assistantService.checkAvailability();
      setAiStatus("connected");
    } catch {
      setAiStatus("unavailable");
    } finally {
      if (!quiet) setCheckingAi(false);
    }
  }, []);

  const inspectPriorityDigest = useCallback(async (expectedIdentity?: string, force = false) => {
    if (mode !== "mock" && mode !== "outlook") return;
    let sequence = priorityInspectionSequence.current;
    let identity: string;
    let email: EmailData;
    try {
      identity = getCurrentEmailIdentity(mode);
      if (expectedIdentity && identity !== expectedIdentity) return;
      if (priorityDigestRequests.current.has(identity) && !force) return;
      sequence = ++priorityInspectionSequence.current;
      email = await createEmailService(mode).getCurrentEmail();
      if (sequence !== priorityInspectionSequence.current || getCurrentEmailIdentity(mode) !== identity) return;
    } catch (error) {
      if (expectedIdentity && sequence === priorityInspectionSequence.current) {
        setPriorityWorkflow({ status: "error", identity: expectedIdentity, error: error instanceof Error ? error.message : "The current email could not be read." });
      }
      return;
    }

    if (!isPriorityDigest(email)) {
      setPriorityWorkflow(null);
      return;
    }

    if (!force) {
      const cached = priorityDigestCache.current.get(identity);
      if (cached) {
        setPriorityWorkflow({ status: cached.suggestPreparation ? "ready" : "none", identity, result: cached });
        return;
      }
    } else {
      priorityDigestCache.current.delete(identity);
    }
    if (priorityDigestRequests.current.has(identity)) return;

    priorityDigestRequests.current.add(identity);
    setPriorityWorkflow({ status: "checking", identity });
    try {
      const { result, provider } = await priorityDigestService.analyse(email);
      if (provider !== "local-llm") throw new Error("The Priority Digest workflow requires local Llama. No mock interpretation was used.");
      if (sequence !== priorityInspectionSequence.current || getCurrentEmailIdentity(mode) !== identity) return;
      priorityDigestCache.current.set(identity, result);
      setPriorityWorkflow({ status: result.suggestPreparation ? "ready" : "none", identity, result });
    } catch (error) {
      if (sequence === priorityInspectionSequence.current) {
        setPriorityWorkflow({ status: "error", identity, error: error instanceof Error ? error.message : "Priority Digest analysis failed." });
      }
    } finally {
      priorityDigestRequests.current.delete(identity);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "mock") {
      void inspectPriorityDigest();
      return;
    }
    if (mode !== "outlook") return;

    void inspectPriorityDigest();
    if (typeof Office === "undefined" || !Office.context?.mailbox || !Office.context.requirements.isSetSupported("Mailbox", "1.5")) return;

    const mailbox = Office.context.mailbox;
    const onItemChanged = () => { void inspectPriorityDigest(); };
    try {
      mailbox.addHandlerAsync(Office.EventType.ItemChanged, onItemChanged);
      return () => mailbox.removeHandlerAsync(Office.EventType.ItemChanged);
    } catch {
      // Older classic Outlook builds still get the automatic inspection when the pane opens.
    }
  }, [mode, mockEmailId, inspectPriorityDigest]);

  useEffect(() => {
    void checkAi(true);
    const interval = window.setInterval(() => void checkAi(true), 30_000);
    return () => window.clearInterval(interval);
  }, [checkAi]);

  function addAssistant(text: string, source: Message["source"], extra: Partial<Message> = {}) {
    setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text, source, ...extra }]);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || typing) return;
    if (text.toLowerCase() === "summary") {
      setInput("");
      await runEmailSummary("summary");
      return;
    }
    setInput("");
    await runChatTurn(text);
  }

  async function runChatTurn(text: string) {
    if (typing) return;
    const turn = ++turnId.current;
    const userMessage: Message = { id: nextId.current++, role: "user", text };
    const priorMessages = messages;
    let emailChanged = false;
    setMessages((current) => [...current, userMessage]);
    setTyping(true);
    try {
      let activeContext = emailContext.current;
      if (activeContext) {
        try {
          const currentIdentity = getCurrentEmailIdentity(mode);
          if (currentIdentity !== activeContext.identity) {
            emailContext.current = null;
            pendingProposal.current = null;
            activeContext = null;
            emailChanged = true;
            setMessages([{ id: nextId.current++, role: "assistant", text: "The open email changed, so I cleared the previous email conversation context. Ask about the newly open email or start a new chat.", source: "error" }, userMessage]);
          }
        } catch {
          emailContext.current = null;
          pendingProposal.current = null;
          activeContext = null;
          emailChanged = true;
          setMessages([{ id: nextId.current++, role: "assistant", text: "I couldn't verify which email is open, so I cleared the saved email context for safety. Open a message and summarise it again before asking about its contents.", source: "error" }, userMessage]);
        }
      }

      const useEmailContext = Boolean(activeContext && questionNeedsEmail(text));
      try {
        const history = getHistory(emailChanged ? [] : priorMessages);
        const latestMeetingResult = [...priorMessages].reverse().find((message) => message.meetingResult)?.meetingResult;
        const result = await brainOrchestrator.process({
          prompt: text,
          conversationContext: history,
          currentEmailContext: useEmailContext ? activeContext?.email.body : undefined,
          pendingTaskProposal: pendingProposal.current,
          latestMeetingResult,
          allowMockFallback: !isEmailDependent(text, useEmailContext),
        });
        if (turn === turnId.current) {
          const taskProposal = result.agentResults.find((agentResult) => agentResult.taskProposal)?.taskProposal;
          const meetingResult = result.agentResults.find((agentResult) => agentResult.meeting)?.meeting;
          if (taskProposal) {
            const previousProposal = pendingProposal.current;
            if (previousProposal && previousProposal.proposalId !== taskProposal.proposalId) {
              setMessages((items) => items.map((message) => message.taskProposal?.proposalId === previousProposal.proposalId
                ? { ...message, taskProposal: { ...previousProposal, status: "superseded" } }
                : message));
            }
            pendingProposal.current = taskProposal;
          }
          const source: Message["source"] = result.provider === "mock" || result.status === "mock-fallback"
            ? "mock"
            : result.status === "error" || result.status === "unavailable" ? "error" : "local-llm";
          setAiStatus(source === "error" || source === "mock" ? "unavailable" : "connected");
          addAssistant(result.response || (meetingResult ? "" : "I couldn't complete that request."), source, {
            ...(taskProposal ? { taskProposal } : {}),
            ...(meetingResult ? { meetingResult } : {}),
            ...(result.handledBy.length ? { handledBy: result.handledBy } : {}),
          });
        }
      } catch (error) {
        if (turn === turnId.current) {
          setAiStatus("unavailable");
          if (isEmailDependent(text, useEmailContext)) {
            const detail = error instanceof Error ? error.message : "The request to Ollama failed.";
            addAssistant(`${unavailableMessage} I did not create an email summary or email-specific answer. ${detail}`, "error");
          } else {
            const detail = error instanceof Error ? error.message : "The local AI request failed.";
            addAssistant(`${unavailableMessage} ${detail} Use Retry to check the local model connection.`, "error");
          }
        }
      }
    } catch (error) {
      if (turn === turnId.current) addAssistant(error instanceof Error ? error.message : unavailableMessage, "error");
    } finally {
      if (turn === turnId.current) setTyping(false);
      field.current?.focus();
    }
  }

  async function runEmailSummary(userText = "Summarise the current email") {
    if (typing) return;
    const turn = ++turnId.current;
    const userMessage: Message = { id: nextId.current++, role: "user", text: userText };
    setMessages((current) => [...current, userMessage]);
    setTyping(true);
    try {
      const summarySkill = await loadEmailSummarySkill();
      if (mode === "detecting") throw new Error("Brain is still connecting to Outlook. Please wait a moment and try again.");
      if (mode === "unavailable") throw new Error("The email service is unavailable in this window. Open the app in a browser or in Outlook and try again.");

      const identity = getCurrentEmailIdentity(mode);
      const email = await createEmailService(mode).getCurrentEmail();
      const emailChanged = Boolean(emailContext.current && emailContext.current.identity !== identity);
      if (emailChanged) {
        pendingProposal.current = null;
        setMessages([{ id: nextId.current++, role: "assistant", text: "The open email changed, so I cleared the previous email conversation context before summarising this message.", source: "error" }, userMessage]);
      }
      emailContext.current = { identity, email };
      const summaryReply = await summariseEmailBody(summarySkill, email.body);
      if (getCurrentEmailIdentity(mode) !== identity) {
        emailContext.current = null;
        throw new Error("The open email changed while Brain was summarising it. The result was discarded; summarise the newly open email again.");
      }
      if (turn === turnId.current) {
        setAiStatus("connected");
        setMessages((current) => [...current, {
          id: nextId.current++, role: "assistant", text: "", email, summary: summaryReply.text, source: summaryReply.provider,
        }]);
      }
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "An unexpected error occurred.";
      if (turn === turnId.current) {
        if (/open email changed while/i.test(detail)) {
          addAssistant(detail, "error");
          return;
        }
        const aiUnavailable = /ollama|local model|local ai|timed out|HTTP \d+/i.test(detail);
        if (aiUnavailable) {
          setAiStatus("unavailable");
          addAssistant(`${unavailableMessage} No mock summary was created. ${detail}`, "error");
        } else {
          addAssistant(`I couldn't retrieve or summarise the current email. No email content was replaced with a sample. ${detail}`, "error");
        }
      }
    } finally {
      if (turn === turnId.current) setTyping(false);
      field.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  function newChat() {
    turnId.current += 1;
    emailContext.current = null;
    pendingProposal.current = null;
    setMessages([]);
    setInput("");
    setTyping(false);
    field.current?.focus();
  }

  function changeProposal(proposalId: string, transform: (proposal: TaskProposal) => TaskProposal) {
    const current = pendingProposal.current;
    if (!current || current.proposalId !== proposalId || current.status !== "proposal") return;
    const updated = { ...transform(current), approvalKey: `approval-${crypto.randomUUID()}` };
    pendingProposal.current = updated;
    setMessages((items) => items.map((message) => message.taskProposal?.proposalId === proposalId
      ? { ...message, taskProposal: updated, proposalFeedback: undefined, plannerResult: undefined }
      : message));
  }

  function updateProposedTask(proposalId: string, taskId: string, patch: Partial<ProposedTask>) {
    changeProposal(proposalId, (proposal) => ({
      ...proposal,
      tasks: proposal.tasks.map((task) => {
        if (task.taskId !== taskId) return task;
        const updated = { ...task, ...patch };
        updated.schedulingConflicts = updated.proposedSchedule
          ? mockCalendarService.findConflicts(updated.proposedSchedule.startAt, updated.proposedSchedule.endAt, proposal.calendar.appointments)
          : [];
        return updated;
      }),
    }));
  }

  function addProposedTask(proposalId: string) {
    const taskId = `user-task-${crypto.randomUUID()}`;
    changeProposal(proposalId, (proposal) => ({ ...proposal, tasks: [...proposal.tasks, {
      taskId,
      title: "New task",
      description: "",
      proposedDueDate: null,
      dependencies: [],
      estimatedDurationMinutes: null,
      schedulingConstraints: [],
      proposedSchedule: null,
      schedulingConflicts: [],
    }] }));
  }

  function removeProposedTask(proposalId: string, taskId: string) {
    changeProposal(proposalId, (proposal) => ({
      ...proposal,
      tasks: proposal.tasks
        .filter((task) => task.taskId !== taskId)
        .map((task) => ({ ...task, dependencies: task.dependencies.filter((dependency) => dependency !== taskId) })),
    }));
  }

  function cancelProposal(proposalId: string, messageId: number) {
    const current = pendingProposal.current;
    if (!current || current.proposalId !== proposalId) return;
    const cancelled = { ...current, status: "cancelled" as const };
    pendingProposal.current = null;
    setMessages((items) => items.map((message) => message.id === messageId ? { ...message, taskProposal: cancelled } : message));
    addAssistant("Cancelled. No tasks were created.", "local-llm");
  }

  async function approveProposal(proposalId: string, messageId: number) {
    const proposal = pendingProposal.current;
    if (!proposal || proposal.proposalId !== proposalId || approvalLocks.current.has(proposalId)) return;
    const issues = validateProposalForApproval(proposal);
    if (issues.length) {
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, proposalFeedback: issues.slice(0, 4).join(" ") } : message));
      return;
    }

    approvalLocks.current.add(proposalId);
    setMessages((items) => items.map((message) => message.id === messageId ? { ...message, isCreatingTasks: true, proposalFeedback: undefined } : message));
    try {
      const result = await mockPlannerService.createTasks(proposal.approvalKey, proposal.tasks);
      const lines = result.created.map((task) => `• ${task.title} (${task.mockTaskId})`);
      const summary = result.errors.length
        ? `Mock Planner partially created ${result.created.length} of ${proposal.tasks.length} tasks.\n${lines.join("\n")}\nCould not create: ${result.errors.map((error) => `${error.taskId}: ${error.message}`).join("; ")}`
        : `Successfully created ${result.created.length} tasks in Mock Planner.\n${lines.join("\n")}${result.duplicateApproval ? "\nThis approval was already processed; the existing mock tasks were returned." : ""}`;
      if (result.created.length > 0) {
        const createdProposal = { ...proposal, status: "created" as const };
        pendingProposal.current = null;
        setMessages((items) => items.map((message) => message.id === messageId
          ? { ...message, taskProposal: createdProposal, isCreatingTasks: false, plannerResult: summary }
          : message));
      } else {
        const retryable = { ...proposal, approvalKey: `approval-${crypto.randomUUID()}` };
        pendingProposal.current = retryable;
        setMessages((items) => items.map((message) => message.id === messageId
          ? { ...message, taskProposal: retryable, isCreatingTasks: false, proposalFeedback: summary }
          : message));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Mock Planner returned an unexpected error.";
      setMessages((items) => items.map((message) => message.id === messageId
        ? { ...message, isCreatingTasks: false, proposalFeedback: `Mock Planner failed. No success is being reported. ${detail}` }
        : message));
    } finally {
      approvalLocks.current.delete(proposalId);
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><BrainCircuit20Regular /></div>
      <div className="brand-copy"><strong>Brain Assistant</strong><span>Your thinking companion</span></div>
      <span className={`mode-badge ${mode}`} aria-live="polite">
        {mode === "mock" ? "Mock Mode" : mode === "outlook" ? "Outlook Live" : mode === "unavailable" ? "Office.js unavailable" : "Connecting"}
      </span>
      {mode === "mock" && <select
        className="mock-email-picker"
        aria-label="Select a browser mock email"
        value={mockEmailId}
        onChange={(event) => {
          const nextId = event.currentTarget.value;
          selectMockEmail(nextId);
          setPriorityWorkflow(null);
          setMockEmailId(nextId);
        }}
      >
        {getMockEmailOptions().map((email) => <option key={email.id} value={email.id}>{email.label}</option>)}
      </select>}
      <div className={`ai-status ${aiStatus}`} aria-live="polite">
        <i />{aiStatus === "connected" ? "Local AI Connected" : aiStatus === "checking" ? "Checking AI" : "Local AI unavailable"}
        {aiStatus !== "connected" && <Button appearance="subtle" size="small" disabled={checkingAi} onClick={() => void checkAi()} className="retry-button">{checkingAi ? "Checking…" : "Retry"}</Button>}
      </div>
      <Button appearance="subtle" icon={<ChatAdd20Regular />} onClick={newChat} aria-label="New chat" title="New chat" className="new-chat">New chat</Button>
    </header>
    <section className="conversation" aria-label="Chat conversation" aria-live="polite">
      {messages.length === 0 && !priorityWorkflow ? <div className="welcome">
        <div className="welcome-orb"><Sparkle20Filled /></div>
        <h1>{welcome}</h1>
        <p>Ask me to draft, plan, summarize, or think something through.</p>
        <span className="simulated-note">Local Llama through Ollama · no cloud AI</span>
      </div> : <div className="message-list">
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" && <span className="message-icon"><BrainCircuit20Regular /></span>}
          <div className="message-content">
            <span className="message-author">
              {message.role === "user" ? "You" : message.source === "local-llm" ? "Brain · Local AI" : message.source === "error" ? "Brain · status" : "Brain · Mock Response"}
            </span>
            {message.role === "assistant" && message.handledBy && <span className="agent-indicator">{message.handledBy.map((agent) => `${agent[0].toUpperCase()}${agent.slice(1)} Agent`).join(" · ")}</span>}
            {message.email && message.summary ? <EmailSummary email={message.email} summary={message.summary} /> : message.email ? <EmailDetails email={message.email} /> : <>
              {message.text && <p>{message.text}</p>}
              {message.meetingResult && <MeetingAgentCard key={`${message.id}-${message.meetingResult.intent}`} data={message.meetingResult} />}
              {message.taskProposal && <TaskProposalCard
                key={message.taskProposal.proposalId}
                proposal={message.taskProposal}
                creating={Boolean(message.isCreatingTasks)}
                creationResult={message.plannerResult}
                onUpdateTask={(taskId, patch) => updateProposedTask(message.taskProposal!.proposalId, taskId, patch)}
                onAddTask={() => addProposedTask(message.taskProposal!.proposalId)}
                onRemoveTask={(taskId) => removeProposedTask(message.taskProposal!.proposalId, taskId)}
                onApprove={() => void approveProposal(message.taskProposal!.proposalId, message.id)}
                onCancel={() => cancelProposal(message.taskProposal!.proposalId, message.id)}
              />}
              {message.proposalFeedback && <p className="task-validation" role="status">{message.proposalFeedback}</p>}
            </>}
          </div>
        </article>)}
        {priorityWorkflow && <article className="message assistant priority-workflow-message" key={`priority-workflow-${priorityWorkflow.identity}`}>
          <span className="message-icon"><BrainCircuit20Regular /></span>
          <div className="message-content">
            <span className="message-author">{priorityWorkflow.status === "checking" ? "Brain · Local AI" : priorityWorkflow.status === "error" ? "Brain · status" : "Brain · Local AI"}</span>
            {priorityWorkflow.status === "checking" && <div className="priority-analysis-status" role="status"><Spinner size="tiny" /> Analysing the Daily Priority Digest locally…</div>}
            {priorityWorkflow.status === "error" && <div className="priority-analysis-error" role="alert">
              <p>I couldn't analyse the Daily Priority Digest. {priorityWorkflow.error}</p>
              <Button appearance="secondary" size="small" onClick={() => void inspectPriorityDigest(priorityWorkflow.identity, true)}>Retry digest analysis</Button>
            </div>}
            {priorityWorkflow.status === "none" && <p>{priorityWorkflow.result.importantMeetingsTodaySectionFound
              ? "I found the IMPORTANT MEETINGS TODAY section, but no meetings to prepare for."
              : "I couldn't find an IMPORTANT MEETINGS TODAY section in this Daily Priority Digest."}</p>}
            {priorityWorkflow.status === "ready" && <PriorityDigestCard key={priorityWorkflow.identity} emailIdentity={priorityWorkflow.identity} digest={priorityWorkflow.result} />}
            {(priorityWorkflow.status === "ready" || priorityWorkflow.status === "none") && <Button appearance="subtle" size="small" onClick={() => void inspectPriorityDigest(priorityWorkflow.identity, true)} className="priority-reanalyse-button">Reanalyse digest</Button>}
          </div>
        </article>}
        {typing && <div className="message assistant"><span className="message-icon"><BrainCircuit20Regular /></span><div className="typing" aria-label="Brain is thinking"><i/><i/><i/></div></div>}
        <div ref={bottom}/>
      </div>}
    </section>
    <footer className="composer-area">
      <div className="composer-actions">
        <Button appearance="secondary" icon={typing ? <Spinner size="tiny" /> : <Sparkle20Filled />} disabled={typing || mode === "detecting" || mode === "unavailable"} onClick={() => void runEmailSummary()} className="summarize-button">
          {typing ? "Working…" : "Summarise Email"}
        </Button>
      </div>
      <form className="composer" onSubmit={(event) => void send(event)}>
        <textarea ref={field} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={onKeyDown}
          placeholder="Message Brain…" aria-label="Message Brain" rows={1} maxLength={2000} />
        <Button type="submit" appearance="primary" icon={<ArrowUp20Filled />} disabled={!input.trim() || typing} aria-label="Send message" title="Send message" className="send-button" />
      </form>
      <p className="disclaimer">
        {mode === "mock" ? "Choose a sample email above; matching Priority Digests are analysed by local Ollama." : mode === "outlook" ? "Only the open email is read; email content is sent to local Ollama when needed." : "Email content is sent only to local Ollama when you summarise or ask a related follow-up."} {historyStorageAvailable ? "Chat history is saved in this device's local app storage. New chat clears it." : "Local storage is unavailable; this chat may not survive a pane restart."}
      </p>
    </footer>
  </main>;
}

function EmailSummary({ email, summary }: { email: EmailData; summary: string }) {
  const date = new Date(email.receivedAt);
  const received = Number.isNaN(date.getTime()) ? email.receivedAt : date.toLocaleString();
  return <div className="email-details">
    <dl>
      <div><dt>From</dt><dd>{email.senderName}</dd></div>
      <div><dt>Email</dt><dd>{email.senderEmail}</dd></div>
      <div><dt>Received</dt><dd>{received}</dd></div>
      <div><dt>Subject</dt><dd>{email.subject}</dd></div>
    </dl>
    <div className="email-body-block summary-block"><h2>Summary · generated locally</h2><p className="email-body">{summary}</p></div>
  </div>;
}

function EmailDetails({ email }: { email: EmailData }) {
  const date = new Date(email.receivedAt);
  const received = Number.isNaN(date.getTime()) ? email.receivedAt : date.toLocaleString();
  return <div className="email-details">
    <dl>
      <div><dt>From</dt><dd>{email.senderName}</dd></div>
      <div><dt>Email</dt><dd>{email.senderEmail}</dd></div>
      <div><dt>Received</dt><dd>{received}</dd></div>
      <div><dt>Subject</dt><dd>{email.subject}</dd></div>
    </dl>
    <div className="email-body-block"><h2>Full email</h2><p className="email-body">{email.body || "(empty message body)"}</p></div>
  </div>;
}
