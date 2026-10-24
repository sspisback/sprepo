import { assistantService, type AssistantReply } from "./assistantService";
import type { EmailData } from "./emailService";

export type PriorityMeeting = {
  meetingId: string;
  title: string;
  time: string | null;
  date: string | null;
  context: string;
};

export type PriorityDigestResult = {
  importantMeetingsTodaySectionFound: boolean;
  meetingsIdentified: boolean;
  meetings: PriorityMeeting[];
  suggestPreparation: boolean;
};

export interface PriorityDigestLlm {
  chat(request: Parameters<typeof assistantService.chat>[0]): ReturnType<typeof assistantService.chat>;
}

export const priorityDigestResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    importantMeetingsTodaySectionFound: {
      type: "boolean",
      description: "True if and only if the email body contains the IMPORTANT MEETINGS TODAY section heading, even when the section has no meeting rows.",
    },
    meetingsIdentified: { type: "boolean", description: "True only when one or more meeting entries were extracted from that section." },
    meetings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          meetingId: { type: "string" },
          title: { type: "string" },
          time: { anyOf: [{ type: "string" }, { type: "null" }] },
          date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
          context: { type: "string" },
        },
        required: ["meetingId", "title", "time", "date", "context"],
        additionalProperties: false,
      },
    },
    suggestPreparation: { type: "boolean" },
  },
  required: ["importantMeetingsTodaySectionFound", "meetingsIdentified", "meetings", "suggestPreparation"],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("Llama returned invalid JSON for the Priority Digest. No meeting preparation was offered. Retry the analysis.");
  }
}

export function validatePriorityDigest(value: unknown): PriorityDigestResult {
  if (!isRecord(value)) throw new Error("Llama returned an invalid Priority Digest result. No meeting preparation was offered. Retry the analysis.");
  if (typeof value.importantMeetingsTodaySectionFound !== "boolean" || typeof value.meetingsIdentified !== "boolean" || typeof value.suggestPreparation !== "boolean" || !Array.isArray(value.meetings)) {
    throw new Error("Llama's Priority Digest result had missing or invalid fields. No meeting preparation was offered. Retry the analysis.");
  }

  const ids = new Set<string>();
  const meetings = value.meetings.map((item, index): PriorityMeeting => {
    if (!isRecord(item)) throw new Error(`Llama returned an invalid meeting at position ${index + 1}. No meeting preparation was offered. Retry the analysis.`);
    const { meetingId, title, time, date, context } = item;
    if (typeof meetingId !== "string" || !meetingId.trim() || ids.has(meetingId.trim())) {
      throw new Error("Llama returned missing or duplicate meeting IDs. No meeting preparation was offered. Retry the analysis.");
    }
    if (typeof title !== "string" || !title.trim() || (time !== null && typeof time !== "string") || (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) || typeof context !== "string") {
      throw new Error(`Llama returned invalid details for meeting ${index + 1}. No meeting preparation was offered. Retry the analysis.`);
    }
    ids.add(meetingId.trim());
    return { meetingId: meetingId.trim(), title: title.trim(), time: typeof time === "string" ? time.trim() || null : null, date: typeof date === "string" ? date : null, context: context.trim() };
  });

  const meetingsIdentified = meetings.length > 0;
  if (value.meetingsIdentified !== meetingsIdentified || value.suggestPreparation !== meetingsIdentified || (!value.importantMeetingsTodaySectionFound && meetingsIdentified)) {
    throw new Error("Llama returned inconsistent Priority Digest results. No meeting preparation was offered. Retry the analysis.");
  }

  return { importantMeetingsTodaySectionFound: value.importantMeetingsTodaySectionFound, meetingsIdentified, meetings, suggestPreparation: value.suggestPreparation };
}

async function loadPrioritySkill(): Promise<string> {
  const response = await fetch("/api/priority/skill", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load skills/priority.md (HTTP ${response.status}).`);
  const skill = (await response.text()).trim();
  if (!skill) throw new Error("skills/priority.md is empty.");
  return skill;
}

export class PriorityDigestService {
  constructor(private readonly llm: PriorityDigestLlm = assistantService) {}

  async analyse(email: Pick<EmailData, "body" | "receivedAt">): Promise<{ result: PriorityDigestResult; provider: AssistantReply["provider"] }> {
    const skill = await loadPrioritySkill();
    const received = new Date(email.receivedAt);
    const receivedDate = Number.isNaN(received.getTime()) ? email.receivedAt : received.toLocaleString();
    const emailContext = `Email received date/time (user's local timezone): ${receivedDate}\n\nEmail body:\n${email.body}`;
    const reply = await this.llm.chat({
      history: [{ role: "user", content: "Analyse the supplied current email using the priority skill. Return only the required JSON object." }],
      emailContext,
      systemInstructions: skill,
      responseFormat: priorityDigestResponseSchema,
      allowMockFallback: false,
      timeoutMs: 300_000,
      maxOutputTokens: 900,
      contextWindow: 8192,
      temperature: 0,
    });
    return { result: validatePriorityDigest(parseJson(reply.text)), provider: reply.provider };
  }
}

export const priorityDigestService = new PriorityDigestService();
