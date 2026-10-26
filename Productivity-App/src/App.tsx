import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowUp20Filled, Attach20Regular, BrainCircuit20Regular, ChatAdd20Regular, Delete20Regular, Sparkle20Filled } from "@fluentui/react-icons";
import { createEmailService, detectAddinMode, getCurrentEmailIdentity, getMockEmailOptions, getSelectedMockEmailId, selectMockEmail, type AddinMode, type EmailData } from "./emailService";
import { loadEmailSummarySkill, summariseEmailBody } from "./emailSummaryService";
import { assistantService } from "./assistantService";
import { brainOrchestrator } from "./orchestratorService";
import LabProposalCard from "./LabProposalCard";
import { labAgent } from "./labAgent";
import { loadSpecialistSkill } from "./skillLoader";
import { mockLabIntegrationService } from "./mockLabIntegrationService";
import type { LabProposal } from "./labTypes";
import MeetingAgentCard from "./MeetingAgentCard";
import type { KnowledgeSourceReference, MeetingAgentData, SpecialistAgentName } from "./agentContracts";
import { isPriorityDigest } from "./priorityDigestDetector";
import { priorityDigestService, type PriorityDigestResult } from "./priorityDigestService";
import PriorityDigestCard from "./PriorityDigestCard";
import { mockCalendarService } from "./mockCalendarService";
import { mockPlannerService } from "./mockPlannerService";
import TaskProposalCard from "./TaskProposalCard";
import { validateProposalForApproval, type ProposedTask, type TaskProposal } from "./taskPlanningService";
import type { ChatTurn } from "./llmService";
import { deleteKnowledgeDocument, importSampleKnowledgeDocuments, listKnowledgeDocuments, uploadKnowledgeDocument, type KnowledgeDocument } from "./knowledgeService";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  email?: EmailData;
  summary?: string;
  source?: "mock" | "local-llm" | "error";
  taskProposal?: TaskProposal;
  labProposal?: LabProposal;
  meetingResult?: MeetingAgentData;
  handledBy?: SpecialistAgentName[];
  isCreatingTasks?: boolean;
  isSubmittingLab?: boolean;
  proposalFeedback?: string;
  plannerResult?: string;
  knowledgeSources?: KnowledgeSourceReference[];
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

function formatEmailContext(email: EmailData): string {
  return [
    "CURRENTLY SELECTED EMAIL (the authoritative email for this request)",
    `From: ${email.senderName} <${email.senderEmail}>`,
    `Received: ${email.receivedAt}`,
    `Subject: ${email.subject}`,
    "Body:",
    email.body,
  ].join("\n");
}

function isLabRequest(text: string): boolean {
  return /\blab\b/i.test(text)
    || /\b(?:create|make|build|prepare|draft|generate|send|submit|ask)\b[\s\S]{0,60}\b(?:slides?|slide\s+deck|presentation)\b/i.test(text);
}

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
    )).map((message) => ({ ...message, isCreatingTasks: false, isSubmittingLab: false }));
  } catch {
    return [];
  }
}

function questionNeedsEmail(text: string): boolean {
  return /^\s*(?:please\s+)?summari[sz]e(?:\s+this)?\s*[.!?]*$/i.test(text)
    || /\b(reply|respond|say back|write back|answer them)\b|\b(sender|subject|deadline|action item|their request)\b|\b(this|that|current|open|previous|attached|above)\s+(email|message)\b|\b(what did|what does|what are).{0,30}\b(email|message|they|sender)\b/i.test(text);
}

function isEmailDependent(text: string, emailContextUsed: boolean): boolean {
  if (emailContextUsed) return true;
  return /\b(summary|summari[sz]e|recap)\b.{0,35}\b(email|message)\b|\b(email|message)\b.{0,35}\b(summary|summari[sz]e|recap|content|body)\b|\b(current|open|this|that|previous|attached)\s+(email|message)\b|\b(what should i|how do i|can you help me)\s+(reply|respond)\b|\b(reply|respond|write back|say back)\s+to\s+(it|them|this|that|the sender|the email|the message)\b|\b(sender|subject|attachment|deadline|action item|their request)\b/i.test(text);
}

function getHistory(messages: Message[]): ChatTurn[] {
  return messages.flatMap((message): ChatTurn[] => {
    if (message.role === "user") return [{ role: "user", content: message.text }];
    const content = [
      message.summary || message.text,
      message.taskProposal ? `Structured task proposal: ${JSON.stringify({ status: message.taskProposal.status, tasks: message.taskProposal.tasks, clarificationQuestions: message.taskProposal.clarificationQuestions })}` : "",
      message.meetingResult ? `Structured meeting result: ${JSON.stringify(message.meetingResult)}` : "",
      message.labProposal ? `Structured Lab proposal: ${JSON.stringify({ status: message.labProposal.status, actionType: message.labProposal.actionType, clientProject: message.labProposal.clientProject, prompt: message.labProposal.prompt })}` : "",
    ].filter(Boolean).join("\n");
    return content && message.source !== "error" ? [{ role: "assistant", content }] : [];
  });
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>(restoreConversation);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [historyStorageAvailable, setHistoryStorageAvailable] = useState(true);
  const [emailSelectionLabel, setEmailSelectionLabel] = useState("");
  const [mode, setMode] = useState<AddinMode>("detecting");
  const [mockEmailId, setMockEmailId] = useState(getSelectedMockEmailId);
  const [priorityWorkflow, setPriorityWorkflow] = useState<PriorityWorkflowState | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>("checking");
  const [checkingAi, setCheckingAi] = useState(false);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeNotice, setKnowledgeNotice] = useState("");
  const [labResultJobId, setLabResultJobId] = useState(() => readLabResultJobId());
  const nextId = useRef(messages.reduce((highest, message) => Math.max(highest, message.id), -1) + 1);
  const turnId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const documentPicker = useRef<HTMLInputElement>(null);
  const emailContext = useRef<EmailContext | null>(null);
  const pendingProposal = useRef<TaskProposal | null>(
    [...messages].reverse().find((message) => message.taskProposal &&
      (message.taskProposal.status === "proposal" || message.taskProposal.status === "clarification"))?.taskProposal ?? null,
  );
  const pendingLabProposal = useRef<LabProposal | null>(
    [...messages].reverse().find((message) => message.labProposal &&
      (message.labProposal.status === "proposal" || message.labProposal.status === "clarification"))?.labProposal ?? null,
  );
  const approvalLocks = useRef(new Set<string>());
  const priorityDigestCache = useRef(new Map<string, PriorityDigestResult>());
  const priorityDigestRequests = useRef(new Set<string>());
  const priorityInspectionSequence = useRef(0);
  const emailSelectionSequence = useRef(0);

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

  const refreshSelectedEmail = useCallback(async () => {
    const sequence = ++emailSelectionSequence.current;
    emailContext.current = null;
    setEmailSelectionLabel("Loading selected email…");

    const taskProposal = pendingProposal.current;
    if (taskProposal && (taskProposal.status === "proposal" || taskProposal.status === "clarification")) {
      setMessages((current) => current.map((message) => message.taskProposal?.proposalId === taskProposal.proposalId
        ? { ...message, taskProposal: { ...taskProposal, status: "superseded" } }
        : message));
    }
    const labProposal = pendingLabProposal.current;
    if (labProposal && (labProposal.status === "proposal" || labProposal.status === "clarification")) {
      setMessages((current) => current.map((message) => message.labProposal?.proposalId === labProposal.proposalId
        ? { ...message, labProposal: { ...labProposal, status: "superseded" } }
        : message));
    }
    pendingProposal.current = null;
    pendingLabProposal.current = null;

    try {
      const identity = getCurrentEmailIdentity(mode);
      const email = await createEmailService(mode).getCurrentEmail();
      if (sequence !== emailSelectionSequence.current || getCurrentEmailIdentity(mode) !== identity) return;
      emailContext.current = { identity, email };
      setEmailSelectionLabel(`Current email: ${email.subject || "(no subject)"}`);
    } catch {
      if (sequence === emailSelectionSequence.current) setEmailSelectionLabel("No readable email selected");
    }
  }, [mode]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    const onHashChange = () => setLabResultJobId(readLabResultJobId());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
      void refreshSelectedEmail();
      void inspectPriorityDigest();
      return;
    }
    if (mode !== "outlook") return;

    void refreshSelectedEmail();
    void inspectPriorityDigest();
    if (typeof Office === "undefined" || !Office.context?.mailbox || !Office.context.requirements.isSetSupported("Mailbox", "1.5")) return;

    const mailbox = Office.context.mailbox;
    const onItemChanged = () => {
      void refreshSelectedEmail();
      void inspectPriorityDigest();
    };
    try {
      mailbox.addHandlerAsync(Office.EventType.ItemChanged, onItemChanged);
      return () => mailbox.removeHandlerAsync(Office.EventType.ItemChanged);
    } catch {
      // Older classic Outlook builds still get the automatic inspection when the pane opens.
    }
  }, [mode, mockEmailId, inspectPriorityDigest, refreshSelectedEmail]);

  useEffect(() => {
    void checkAi(true);
    const interval = window.setInterval(() => void checkAi(true), 30_000);
    return () => window.clearInterval(interval);
  }, [checkAi]);

  useEffect(() => {
    let active = true;
    void listKnowledgeDocuments().then((documents) => {
      if (active) setKnowledgeDocuments(documents);
    }).catch((error: unknown) => {
      if (active) setKnowledgeNotice(error instanceof Error ? `Local document storage unavailable: ${error.message}` : "Local document storage unavailable.");
    });
    return () => { active = false; };
  }, []);

  async function handleDocumentSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setKnowledgeBusy(true);
    setKnowledgeNotice(`Uploading and indexing ${file.name} locally…`);
    try {
      const result = await uploadKnowledgeDocument(file);
      const documents = await listKnowledgeDocuments();
      setKnowledgeDocuments(documents);
      setKnowledgeNotice(result.duplicate ? `${result.document.filename} is already indexed; no duplicate was created.` : `Ready to search: ${result.document.filename} (${result.document.chunkCount} text chunks).`);
    } catch (error) {
      setKnowledgeNotice(error instanceof Error ? `Indexing failed: ${error.message}` : "Indexing failed.");
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function handleImportSamples() {
    setKnowledgeBusy(true);
    setKnowledgeNotice("Importing the fictional sample documents and creating local embeddings…");
    try {
      const imported = await importSampleKnowledgeDocuments();
      setKnowledgeDocuments(await listKnowledgeDocuments());
      const added = imported.filter((item) => !item.duplicate).length;
      setKnowledgeNotice(added ? `Indexed ${added} fictional sample document${added === 1 ? "" : "s"}.` : "All fictional sample documents are already indexed.");
    } catch (error) {
      setKnowledgeNotice(error instanceof Error ? `Sample indexing failed: ${error.message}` : "Sample indexing failed.");
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function handleDeleteKnowledgeDocument(document: KnowledgeDocument) {
    if (!window.confirm(`Delete ${document.filename} and its indexed passages from this device?`)) return;
    setKnowledgeBusy(true);
    setKnowledgeNotice(`Deleting ${document.filename} and its local vectors…`);
    try {
      await deleteKnowledgeDocument(document.documentId);
      setKnowledgeDocuments(await listKnowledgeDocuments());
      setKnowledgeNotice(`Deleted ${document.filename} from local storage.`);
    } catch (error) {
      setKnowledgeNotice(error instanceof Error ? `Delete failed: ${error.message}` : "Delete failed.");
    } finally {
      setKnowledgeBusy(false);
    }
  }

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
    setMessages((current) => [...current, userMessage]);
    setTyping(true);
    try {
      let activeContext = emailContext.current;
      if (activeContext) {
        try {
          const currentIdentity = getCurrentEmailIdentity(mode);
          if (currentIdentity !== activeContext.identity) {
            emailContext.current = null;
            void refreshSelectedEmail();
            activeContext = null;
          }
        } catch {
          emailContext.current = null;
          activeContext = null;
        }
      }

      // Supply the currently selected email only when the prompt explicitly
      // refers to it. Fail closed: LabAgent will ask for the missing content.
      const wantsEmailContext = questionNeedsEmail(text) || isLabRequest(text);
      if (!activeContext && wantsEmailContext && mode !== "detecting" && mode !== "unavailable") {
        try {
          const identity = getCurrentEmailIdentity(mode);
          const email = await createEmailService(mode).getCurrentEmail();
          if (getCurrentEmailIdentity(mode) === identity) {
            activeContext = { identity, email };
            emailContext.current = activeContext;
            setEmailSelectionLabel(`Current email: ${email.subject || "(no subject)"}`);
          }
        } catch {
          // No sample fallback in Outlook. The specialist receives no email body.
        }
      }

      const useEmailContext = Boolean(activeContext && wantsEmailContext);
      try {
        const history = getHistory(priorMessages);
        const latestMeetingResult = [...priorMessages].reverse().find((message) => message.meetingResult)?.meetingResult;
        const result = await brainOrchestrator.process({
          prompt: text,
          conversationContext: history,
          currentEmailContext: useEmailContext && activeContext ? formatEmailContext(activeContext.email) : undefined,
          pendingTaskProposal: pendingProposal.current,
          pendingLabProposal: pendingLabProposal.current,
          latestMeetingResult,
          allowMockFallback: !isEmailDependent(text, useEmailContext),
        });
        if (turn === turnId.current) {
          if (useEmailContext && activeContext && getCurrentEmailIdentity(mode) !== activeContext.identity) {
            emailContext.current = null;
            addAssistant("The selected email changed while I was working, so I discarded that email-specific result. Your chat history is still here; ask again to use the newly selected email.", "error");
            return;
          }
          const taskProposal = result.agentResults.find((agentResult) => agentResult.taskProposal)?.taskProposal;
          const labProposal = result.agentResults.find((agentResult) => agentResult.labProposal)?.labProposal;
          const meetingResult = result.agentResults.find((agentResult) => agentResult.meeting)?.meeting;
          const knowledgeSources = result.agentResults.find((agentResult) => agentResult.knowledgeSources)?.knowledgeSources;
          if (taskProposal) {
            const previousProposal = pendingProposal.current;
            if (previousProposal && previousProposal.proposalId !== taskProposal.proposalId) {
              setMessages((items) => items.map((message) => message.taskProposal?.proposalId === previousProposal.proposalId
                ? { ...message, taskProposal: { ...previousProposal, status: "superseded" } }
                : message));
            }
            pendingProposal.current = taskProposal;
          }
          if (labProposal) {
            const previousLabProposal = pendingLabProposal.current;
            if (previousLabProposal && previousLabProposal.proposalId !== labProposal.proposalId) {
              setMessages((items) => items.map((message) => message.labProposal?.proposalId === previousLabProposal.proposalId
                ? { ...message, labProposal: { ...previousLabProposal, status: "superseded" } }
                : message));
            }
            pendingLabProposal.current = labProposal.status === "proposal" || labProposal.status === "clarification" ? labProposal : null;
          }
          const source: Message["source"] = result.provider === "mock" || result.status === "mock-fallback"
            ? "mock"
            : result.status === "error" || result.status === "unavailable" ? "error" : "local-llm";
          setAiStatus(source === "error" || source === "mock" ? "unavailable" : "connected");
          const response = result.response?.trim()
            || result.errors?.filter(Boolean).join("\n\n")
            || result.agentResults.map((agentResult) => agentResult.response?.trim()).filter(Boolean).join("\n\n")
            || (meetingResult ? "" : "Brain could not produce a response. Check the local AI connection and try again.");
          addAssistant(response, source, {
            ...(taskProposal ? { taskProposal } : {}),
            ...(labProposal ? { labProposal } : {}),
            ...(meetingResult ? { meetingResult } : {}),
            ...(knowledgeSources?.length ? { knowledgeSources } : {}),
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
        const taskProposal = pendingProposal.current;
        const labProposal = pendingLabProposal.current;
        pendingProposal.current = null;
        pendingLabProposal.current = null;
        if (taskProposal) setMessages((current) => current.map((message) => message.taskProposal?.proposalId === taskProposal.proposalId
          ? { ...message, taskProposal: { ...taskProposal, status: "superseded" } } : message));
        if (labProposal) setMessages((current) => current.map((message) => message.labProposal?.proposalId === labProposal.proposalId
          ? { ...message, labProposal: { ...labProposal, status: "superseded" } } : message));
      }
      emailContext.current = { identity, email };
      setEmailSelectionLabel(`Current email: ${email.subject || "(no subject)"}`);
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
    pendingProposal.current = null;
    pendingLabProposal.current = null;
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

  function updateLabProposal(proposalId: string, transform: (proposal: LabProposal) => LabProposal) {
    const current = pendingLabProposal.current;
    if (!current || current.proposalId !== proposalId || current.status !== "proposal") return;
    const updated = transform(current);
    pendingLabProposal.current = updated;
    setMessages((items) => items.map((message) => message.labProposal?.proposalId === proposalId
      ? { ...message, labProposal: updated, proposalFeedback: undefined }
      : message));
  }

  async function regenerateLabProposal(proposalId: string, messageId: number) {
    const proposal = pendingLabProposal.current;
    if (!proposal || proposal.proposalId !== proposalId || proposal.status !== "proposal") return;
    setMessages((items) => items.map((message) => message.id === messageId ? { ...message, isSubmittingLab: true, proposalFeedback: undefined } : message));
    try {
      const skill = await loadSpecialistSkill("lab");
      const context = emailContext.current && /\b(?:this|that|current|open|attached)\s+(?:email|message)\b/i.test(proposal.originalRequest)
        ? emailContext.current.email.body : undefined;
      const prompt = await labAgent.regenerate({
        originalRequest: proposal.originalRequest,
        actionType: proposal.actionType ?? "analysis",
        clientProject: proposal.clientProject,
        promptDraft: proposal.prompt,
        additionalInstructions: "Retain all user-edited text and make the selected action, project, and remaining sources consistent.",
        currentEmailContext: context,
        sources: proposal.sources,
        skillInstructions: skill,
      });
      if (!prompt.trim()) throw new Error("The local model returned an empty prompt.");
      const revised = { ...proposal, prompt: prompt.trim(), requiresRegeneration: false };
      pendingLabProposal.current = revised;
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, labProposal: revised, isSubmittingLab: false } : message));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Prompt regeneration failed.";
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, isSubmittingLab: false, proposalFeedback: `Could not regenerate the Lab prompt. ${detail}` } : message));
    }
  }

  function cancelLabProposal(proposalId: string, messageId: number) {
    const proposal = pendingLabProposal.current;
    if (!proposal || proposal.proposalId !== proposalId) return;
    pendingLabProposal.current = null;
    setMessages((items) => items.map((message) => message.id === messageId ? { ...message, labProposal: { ...proposal, status: "cancelled" } } : message));
  }

  async function submitLabProposal(proposalId: string, messageId: number) {
    const proposal = pendingLabProposal.current;
    if (!proposal || proposal.proposalId !== proposalId || proposal.status !== "proposal" || proposal.requiresRegeneration || approvalLocks.current.has(proposalId)) return;
    if (!proposal.actionType || !proposal.prompt.trim()) {
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, proposalFeedback: "Choose an action and provide a prompt before submitting." } : message));
      return;
    }
    approvalLocks.current.add(proposalId);
    setMessages((items) => items.map((message) => message.id === messageId ? { ...message, isSubmittingLab: true, proposalFeedback: undefined } : message));
    try {
      const submission = await mockLabIntegrationService.submit({
        requestId: proposal.proposalId,
        prompt: proposal.prompt,
        actionType: proposal.actionType,
        clientProject: proposal.clientProject,
        sources: proposal.sources,
      });
      const submitted = { ...proposal, status: "submitted" as const, submission };
      pendingLabProposal.current = null;
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, labProposal: submitted, isSubmittingLab: false } : message));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The simulated handoff failed.";
      setMessages((items) => items.map((message) => message.id === messageId ? { ...message, isSubmittingLab: false, proposalFeedback: `No request was submitted. ${detail}` } : message));
    } finally {
      approvalLocks.current.delete(proposalId);
    }
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

  if (labResultJobId) return <LabResultView jobId={labResultJobId} onBack={() => { window.location.hash = ""; setLabResultJobId(null); }} />;

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
    <div id="brain-pane-content" className="pane-content">
    {emailSelectionLabel && <div className="selected-email-indicator" title={emailSelectionLabel}>{emailSelectionLabel}</div>}
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
              {message.knowledgeSources && <details className="knowledge-sources">
                <summary>Sources ({message.knowledgeSources.length})</summary>
                <ol>{message.knowledgeSources.map((source) => <li key={source.chunkId}>
                  <strong>{source.filename}</strong>{source.pageNumber ? ` · page ${source.pageNumber}` : source.section ? ` · ${source.section}` : ""}
                  <blockquote>{source.excerpt}</blockquote>
                </li>)}</ol>
              </details>}
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
              {message.labProposal && <LabProposalCard
                key={message.labProposal.proposalId}
                proposal={message.labProposal}
                submitting={Boolean(message.isSubmittingLab)}
                feedback={message.proposalFeedback}
                onPromptChange={(prompt) => updateLabProposal(message.labProposal!.proposalId, (proposal) => ({ ...proposal, prompt }))}
                onRegenerate={() => void regenerateLabProposal(message.labProposal!.proposalId, message.id)}
                onSubmit={() => void submitLabProposal(message.labProposal!.proposalId, message.id)}
                onCancel={() => cancelLabProposal(message.labProposal!.proposalId, message.id)}
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
        <div className="knowledge-controls">
          <input ref={documentPicker} type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain" onChange={(event) => void handleDocumentSelection(event)} hidden />
          <Button appearance="secondary" icon={knowledgeBusy ? <Spinner size="tiny" /> : <Attach20Regular />} disabled={knowledgeBusy} onClick={() => documentPicker.current?.click()} className="knowledge-button">Add document</Button>
          <Button appearance="subtle" disabled={knowledgeBusy} onClick={() => void handleImportSamples()} className="knowledge-sample-button">Add fictional samples</Button>
        </div>
      </div>
      {(knowledgeNotice || knowledgeDocuments.length > 0) && <section className="knowledge-library" aria-label="Local document library">
        {knowledgeNotice && <p className="knowledge-notice" role="status">{knowledgeNotice}</p>}
        {knowledgeDocuments.length > 0 && <details>
          <summary>Indexed documents ({knowledgeDocuments.length})</summary>
          <ul>{knowledgeDocuments.map((document) => <li key={document.documentId}>
            <span><strong>{document.filename}</strong><small>{document.chunkCount} passages · {new Date(document.uploadedAt).toLocaleDateString()}</small></span>
            <Button appearance="subtle" size="small" icon={<Delete20Regular />} aria-label={`Delete ${document.filename}`} title={`Delete ${document.filename}`} disabled={knowledgeBusy} onClick={() => void handleDeleteKnowledgeDocument(document)} />
          </li>)}</ul>
        </details>}
      </section>}
      <form className="composer" onSubmit={(event) => void send(event)}>
        <textarea ref={field} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={onKeyDown}
          placeholder="Message Brain…" aria-label="Message Brain" rows={1} maxLength={2000} />
        <Button type="submit" appearance="primary" icon={<ArrowUp20Filled />} disabled={!input.trim() || typing} aria-label="Send message" title="Send message" className="send-button" />
      </form>
      <p className="disclaimer">
        {mode === "mock" ? "Choose a sample email above; matching Priority Digests are analysed by local Ollama." : mode === "outlook" ? "Only the open email is read; email content is sent to local Ollama when needed." : "Email content is sent only to local Ollama when you summarise or ask a related follow-up."} {historyStorageAvailable ? "Chat history is saved in this device's local app storage. New chat clears it." : "Local storage is unavailable; this chat may not survive a pane restart."}
      </p>
    </footer>
    </div>
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

function readLabResultJobId(): string | null {
  const match = window.location.hash.match(/^#lab-result\/(.+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function findLabSubmission(jobId: string): LabProposal["submission"] | null {
  try {
    const raw = window.localStorage.getItem(conversationStorageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedConversation;
    if (!Array.isArray(saved.messages)) return null;
    for (const message of saved.messages) {
      if (message.labProposal?.submission?.jobId === jobId) return message.labProposal.submission;
    }
  } catch { /* local history may be unavailable */ }
  return null;
}

function LabResultView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const submission = findLabSubmission(jobId);
  return <main className="app-shell lab-result-view">
    <header className="topbar"><div className="brand-mark"><BrainCircuit20Regular /></div><div className="brand-copy"><strong>Brain Assistant</strong><span>Simulated Lab request</span></div><Button appearance="secondary" onClick={onBack}>Back to chat</Button></header>
    <section className="lab-result-card" aria-label="Simulated Lab result">
      {submission ? <>
        <span className="lab-result-status">SUBMITTED · SIMULATED</span>
        <h1>{submission.actionType === "slide_deck" ? "Slide deck request" : "Analysis request"}</h1>
        <p><strong>Job ID:</strong> {submission.jobId}</p>
        {submission.clientProject && <p><strong>Client / project:</strong> {submission.clientProject}</p>}
        <h2>Approved prompt</h2><pre>{submission.prompt}</pre>
        {submission.sources.length > 0 && <><h2>Included local sources</h2><ul>{submission.sources.map((source) => <li key={source.chunkId}>{source.filename}{source.pageNumber ? ` · page ${source.pageNumber}` : source.section ? ` · ${source.section}` : ""}</li>)}</ul></>}
        <p className="lab-result-note">This is only a local simulated handoff. No Lab system received the request and no analysis or slide deck was generated.</p>
      </> : <><h1>Simulated result unavailable</h1><p>This job is not in this browser's saved chat history. Return to Brain Assistant and open the submitted proposal.</p></>}
      <Button appearance="primary" onClick={onBack}>Back to chat</Button>
    </section>
  </main>;
}
