const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const replies = {
  summary: [
    "Here’s a concise summary framework: **What happened**, **why it matters**, and **what to do next**. Share the text you’d like summarized and I can help shape it. *(Simulated response — no email was read.)*",
    "A useful summary usually starts with the main point, followed by two or three supporting details and a clear next step. *(Simulated response — no email was read.)*",
  ],
  draft: [
    "**Subject:** A quick follow-up\n\nHi there,\n\nI wanted to follow up and share a quick update. Please let me know what works best for you, and I’d be happy to coordinate next steps.\n\nBest,\n[Your name]\n\n*(Simulated draft — nothing was sent.)*",
    "**Subject:** Thank you\n\nHi [Name],\n\nThanks for taking the time to connect. I appreciated the conversation and will follow up with the details we discussed.\n\nBest,\n[Your name]\n\n*(Simulated draft — nothing was sent.)*",
  ],
  meeting: [
    "Here’s a simple meeting prep checklist:\n\n- **Goal:** What decision or outcome do you need?\n- **Context:** What should attendees know beforehand?\n- **Questions:** What’s still unclear?\n- **Close:** Confirm owners and next steps.\n\n*(Simulated suggestion — no calendar or email was accessed.)*",
    "Try opening with the outcome you want, then cover the key context, invite questions, and finish by assigning next steps. *(Simulated suggestion — no calendar or email was accessed.)*",
  ],
  general: [
    "One way to approach that is to break it into the goal, the constraints, and the smallest useful next step. What matters most to you here? *(Simulated response.)*",
    "That’s a thoughtful question. I’d start by listing what you know, what you’re assuming, and what information would change your decision. *(Simulated response.)*",
    "Let’s make it manageable: define the outcome, choose one action you can take today, then review what you learn. *(Simulated response.)*",
  ],
};

let sequence = 0;

export async function getMockResponse(message: string): Promise<string> {
  await pause(950);
  const text = message.toLowerCase();
  const category = /summari[sz]|recap|tl;dr/.test(text)
    ? "summary"
    : /draft|write.*email|email.*write/.test(text)
      ? "draft"
      : /meeting|agenda|prepare/.test(text)
        ? "meeting"
        : "general";
  const options = replies[category];
  const response = options[sequence % options.length];
  sequence += 1;
  return response;
}
