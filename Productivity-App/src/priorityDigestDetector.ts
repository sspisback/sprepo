import type { EmailData } from "./emailService";

export const priorityDigestSender = "ssp.soumya@gmail.com";
export const priorityDigestSubject = "Daily Priority Digest";

function normalizeExactMatch(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isPriorityDigest(email: Pick<EmailData, "senderEmail" | "subject">): boolean {
  return normalizeExactMatch(email.senderEmail) === normalizeExactMatch(priorityDigestSender)
    && normalizeExactMatch(email.subject) === normalizeExactMatch(priorityDigestSubject);
}
