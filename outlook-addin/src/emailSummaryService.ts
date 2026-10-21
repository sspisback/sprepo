import { assistantService, type AssistantReply } from "./assistantService";

export async function loadEmailSummarySkill(): Promise<string> {
  const response = await fetch("/api/email-summarisation/skill", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load skills/email-summarisation/summarise.md (HTTP ${response.status}).`);
  }
  const skill = (await response.text()).trim();
  if (!skill) throw new Error("skills/email-summarisation/summarise.md is empty.");
  return skill;
}

export function summariseEmailBody(
  skill: string,
  emailBody: string,
): Promise<AssistantReply> {
  return assistantService.chat({
    // Email summaries must not inherit facts from the ongoing chat transcript.
    // This fresh task turn keeps the selected email as the only email source.
    history: [{ role: "user", content: "Summarise the currently selected email using the supplied skill instructions." }],
    emailContext: emailBody,
    systemInstructions: skill,
    allowMockFallback: false,
    timeoutMs: 300_000,
    maxOutputTokens: 500,
    contextWindow: 8192,
    temperature: 0,
  });
}
