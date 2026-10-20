import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowUp20Filled, BrainCircuit20Regular, ChatAdd20Regular, Sparkle20Filled } from "@fluentui/react-icons";
import { getMockResponse } from "./mockAssistant";
import { createEmailService, detectAddinMode, type AddinMode, type EmailData } from "./emailService";
import { llmService } from "./llmService";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  email?: EmailData;
  summary?: string;
  source?: "simulated" | "mock-email" | "outlook-email" | "local-llm" | "error";
};
const welcome = "Hi! I'm Brain. How can I help you today?";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [mode, setMode] = useState<AddinMode>("detecting");
  const nextId = useRef(0);
  const turnId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

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

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || typing) return;
    const turn = ++turnId.current;
    setInput("");
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text }]);
    setTyping(true);
    try {
      const response = await getMockResponse(text);
      if (turn === turnId.current) setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: response, source: "simulated" }]);
    } catch (caught) {
      if (turn === turnId.current) {
        const detail = caught instanceof Error ? caught.message : "An unexpected error occurred.";
        setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: `I couldn't retrieve the current email. ${detail}` }]);
      }
    } finally {
      if (turn === turnId.current) setTyping(false);
      field.current?.focus();
    }
  }

  async function summarizeEmail() {
    if (typing) return;
    const turn = ++turnId.current;
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text: "Summarise the current email" }]);
    setTyping(true);
    try {
      if (mode === "detecting") throw new Error("Brain is still connecting to Outlook. Please wait a moment and try again.");
      if (mode === "unavailable") throw new Error("The email service is unavailable in this window. Open the app in a browser or in Outlook and try again.");

      let email: EmailData;
      try {
        email = await createEmailService(mode).getCurrentEmail();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "An unexpected email access error occurred.";
        throw new Error(`I couldn't retrieve the email, so I did not send any email content to Ollama. ${detail}`);
      }

      let summary: string;
      try {
        summary = await llmService.summarizeEmail(email.body);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "An unexpected summarization error occurred.";
        throw new Error(`I couldn't generate a summary. No substitute summary was created. ${detail}`);
      }

      if (turn === turnId.current) {
        setMessages((current) => [...current, {
          id: nextId.current++, role: "assistant", text: "", email, summary, source: "local-llm",
        }]);
      }
    } catch (caught) {
      if (turn === turnId.current) {
        const detail = caught instanceof Error ? caught.message : "An unexpected error occurred.";
        setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: detail, source: "error" }]);
      }
    } finally {
      if (turn === turnId.current) setTyping(false);
      field.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  function newChat() { turnId.current += 1; setMessages([]); setInput(""); setTyping(false); field.current?.focus(); }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><BrainCircuit20Regular /></div>
      <div className="brand-copy"><strong>Brain Assistant</strong><span>Your thinking companion</span></div>
      <span className={`mode-badge ${mode}`} aria-live="polite">
        {mode === "mock" ? "Mock Mode" : mode === "outlook" ? "Outlook Live" : mode === "unavailable" ? "Office.js unavailable" : "Connecting"}
      </span>
      <Button appearance="subtle" icon={<ChatAdd20Regular />} onClick={newChat} aria-label="New chat" title="New chat" className="new-chat">New chat</Button>
    </header>
    <section className="conversation" aria-label="Chat conversation" aria-live="polite">
      {messages.length === 0 ? <div className="welcome">
        <div className="welcome-orb"><Sparkle20Filled /></div>
        <h1>{welcome}</h1>
        <p>Ask me to draft, plan, summarize, or think something through.</p>
        <span className="simulated-note">A local demo · responses are simulated</span>
      </div> : <div className="message-list">
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" && <span className="message-icon"><BrainCircuit20Regular /></span>}
          <div className="message-content">
            <span className="message-author">
              {message.role === "user" ? "You" : message.source === "local-llm" ? "Brain · local Llama" : message.source === "error" ? "Brain · status" : message.source === "mock-email" ? "Brain · sample email" : message.source === "outlook-email" ? "Brain · current email" : "Brain · simulated"}
            </span>
            {message.email && message.summary ? <EmailSummary email={message.email} summary={message.summary} /> : message.email ? <EmailDetails email={message.email} /> : <p>{message.text}</p>}
          </div>
        </article>)}
        {typing && <div className="message assistant"><span className="message-icon"><BrainCircuit20Regular /></span><div className="typing" aria-label="Brain is thinking"><i/><i/><i/></div></div>}
        <div ref={bottom}/>
      </div>}
    </section>
    <footer className="composer-area">
      <div className="composer-actions">
        <Button appearance="secondary" icon={typing ? <Spinner size="tiny" /> : <Sparkle20Filled />} disabled={typing || mode === "detecting" || mode === "unavailable"} onClick={() => void summarizeEmail()} className="summarize-button">
          {typing ? "Working…" : "Summarise Email"}
        </Button>
      </div>
      <form className="composer" onSubmit={(event) => void send(event)}>
        <textarea ref={field} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={onKeyDown}
          placeholder="Message Brain…" aria-label="Message Brain" rows={1} maxLength={2000} />
        <Button type="submit" appearance="primary" icon={<ArrowUp20Filled />} disabled={!input.trim() || typing} aria-label="Send message" title="Send message" className="send-button" />
      </form>
      <p className="disclaimer">
        {mode === "mock" ? "Mock Mode uses the sample email; summaries run through Ollama on this computer." : mode === "outlook" ? "Summarisation sends the open email body to Ollama on this computer only." : "Email content is sent only to the local Ollama service when you summarise."}
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
    <div className="email-body-block summary-block">
      <h2>Summary · generated locally</h2>
      <p className="email-body">{summary}</p>
    </div>
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
    <div className="email-body-block">
      <h2>Full email</h2>
      <p className="email-body">{email.body || "(empty message body)"}</p>
    </div>
  </div>;
}
