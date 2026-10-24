export type EmailData = {
  senderName: string;
  senderEmail: string;
  receivedAt: string;
  subject: string;
  body: string;
};

export interface EmailService {
  getCurrentEmail(): Promise<EmailData>;
}

export type AddinMode = "detecting" | "mock" | "outlook" | "unavailable";

export type MockEmailOption = { id: string; label: string };

type MockEmailFixture = EmailData & MockEmailOption;

const priorityDigestBody = [
  "IMPORTANT MEETINGS TODAY",
  "10:00 — SteerCo – Project Atlas",
  "Northwind Energy · Phase 2 scope decision",
  "Prepare me",
  "14:00 — Northwind renewal prep",
  "With Sofia Laine · Pricing options for January",
  "Prepare me",
].join("\n");

const mockEmails: MockEmailFixture[] = [
  {
    id: "product-review",
    label: "Planning for the product review · normal email",
    senderName: "Jordan Lee",
    senderEmail: "jordan.lee@example.com",
    receivedAt: "2026-10-20T09:42:00.000Z",
    subject: "Planning for the product review",
    body: "Hi team,\n\nAhead of Thursday's product review, please send me your latest launch status and any risks that need a decision. I will combine the updates into a short agenda so we can focus on the open items.\n\nCould you share your notes by Wednesday afternoon? Please include the owner, expected completion date, and any dependencies for each risk.\n\nThanks,\nJordan",
  },
  {
    id: "priority-digest",
    label: "Daily Priority Digest · valid (2 meetings)",
    senderName: "Soumya Pal",
    senderEmail: "ssp.soumya@gmail.com",
    receivedAt: "2026-10-21T07:30:00.000Z",
    subject: "Daily Priority Digest",
    body: priorityDigestBody,
  },
  {
    id: "priority-wrong-sender",
    label: "Daily Priority Digest · wrong sender",
    senderName: "Digest Service",
    senderEmail: "digest@example.com",
    receivedAt: "2026-10-21T07:30:00.000Z",
    subject: "Daily Priority Digest",
    body: priorityDigestBody,
  },
  {
    id: "priority-wrong-subject",
    label: "Priority Digest · wrong subject",
    senderName: "Soumya Pal",
    senderEmail: "ssp.soumya@gmail.com",
    receivedAt: "2026-10-21T07:30:00.000Z",
    subject: "Priority Digest",
    body: priorityDigestBody,
  },
  {
    id: "priority-no-meetings",
    label: "Daily Priority Digest · no meetings",
    senderName: "Soumya Pal",
    senderEmail: "ssp.soumya@gmail.com",
    receivedAt: "2026-10-21T07:30:00.000Z",
    subject: "Daily Priority Digest",
    body: "IMPORTANT MEETINGS TODAY\nNo meetings are listed today.",
  },
  {
    id: "priority-no-section",
    label: "Daily Priority Digest · section missing",
    senderName: "Soumya Pal",
    senderEmail: "ssp.soumya@gmail.com",
    receivedAt: "2026-10-21T07:30:00.000Z",
    subject: "Daily Priority Digest",
    body: "TODAY'S PRIORITIES\nReview the project updates and follow up on open actions.",
  },
];

let selectedMockEmailId = mockEmails[0].id;

export function getMockEmailOptions(): MockEmailOption[] {
  return mockEmails.map(({ id, label }) => ({ id, label }));
}

export function getSelectedMockEmailId(): string {
  return selectedMockEmailId;
}

export function selectMockEmail(id: string): void {
  if (!mockEmails.some((email) => email.id === id)) throw new Error("Unknown browser mock email.");
  selectedMockEmailId = id;
}

export class MockEmailService implements EmailService {
  async getCurrentEmail(): Promise<EmailData> {
    const email = mockEmails.find((candidate) => candidate.id === selectedMockEmailId) ?? mockEmails[0];
    const { id: _id, label: _label, ...data } = email;
    return { ...data };
  }
}

export function getCurrentEmailIdentity(mode: AddinMode): string {
  if (mode === "mock") return `mock:${selectedMockEmailId}`;
  if (mode !== "outlook" || typeof Office === "undefined" || !Office.context?.mailbox?.item) {
    throw new Error("Outlook cannot identify the currently open email. Open a message and try again.");
  }
  const item = Office.context.mailbox.item as Office.MessageRead & { itemId?: string };
  if (item.itemType !== Office.MailboxEnums.ItemType.Message || !item.itemId) {
    throw new Error("Outlook did not provide an identity for the open email. Open the message in its own window and try again.");
  }
  return `outlook:${item.itemId}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Outlook returned an unknown error while reading the open message.";
}

function getMessageBody(item: Office.MessageRead): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      item.body.getAsync(Office.CoercionType.Text, (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          const detail = result.error?.message || result.error?.name || "The body could not be read.";
          reject(new Error(detail));
          return;
        }
        resolve(result.value ?? "");
      });
    } catch (error) {
      reject(new Error(errorMessage(error)));
    }
  });
}

export class OutlookEmailService implements EmailService {
  async getCurrentEmail(): Promise<EmailData> {
    if (typeof Office === "undefined" || !Office.context?.mailbox) {
      throw new Error("Office.js mailbox APIs are unavailable in this window.");
    }

    const item = Office.context.mailbox.item as Office.MessageRead | null;
    if (!item) {
      throw new Error("No open email is available. Open a message in Outlook and try again.");
    }
    if (item.itemType !== Office.MailboxEnums.ItemType.Message) {
      throw new Error("The current Outlook item is not an email message.");
    }
    if (!item.sender || !item.dateTimeCreated || !item.subject || !item.body) {
      throw new Error(
        "Outlook did not expose all fields for this message. Confirm the updated ReadItem manifest is installed, then close and reopen Outlook. If this continues, the Outlook host or mailbox policy may be restricting item access. No sample email was substituted.",
      );
    }

    let body: string;
    try {
      body = await getMessageBody(item);
    } catch (error) {
      throw new Error(
        `Outlook could not read the message body with the installed add-in. Confirm the updated ReadItem manifest is installed, then close and reopen Outlook. No sample email was substituted. (${errorMessage(error)})`,
      );
    }

    const receivedAt = item.dateTimeCreated instanceof Date
      ? item.dateTimeCreated.toISOString()
      : new Date(item.dateTimeCreated).toISOString();

    return {
      senderName: item.sender.displayName || "Unknown sender",
      senderEmail: item.sender.emailAddress || "Email address unavailable",
      receivedAt,
      subject: item.subject || "(no subject)",
      body,
    };
  }
}

export function createEmailService(mode: AddinMode): EmailService {
  if (mode === "mock") return new MockEmailService();
  if (mode === "outlook") return new OutlookEmailService();
  throw new Error("Email service is unavailable until the host has been detected.");
}

export async function detectAddinMode(): Promise<AddinMode> {
  const isTopLevelBrowser = window.parent === window;
  if (typeof Office === "undefined") return isTopLevelBrowser ? "mock" : "unavailable";
  if (typeof Office.onReady !== "function") return isTopLevelBrowser ? "mock" : "unavailable";

  try {
    const info = await Office.onReady();
    return info.host === Office.HostType.Outlook ? "outlook" : "mock";
  } catch {
    return isTopLevelBrowser ? "mock" : "unavailable";
  }
}

