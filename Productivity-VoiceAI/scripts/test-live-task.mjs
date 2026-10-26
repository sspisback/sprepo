import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { taskPlanningService } from "../src/taskPlanningService.ts";

const localFetch = globalThis.fetch.bind(globalThis);
globalThis.window = { setTimeout, clearTimeout };
globalThis.fetch = async (input, init) => {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (path.startsWith("/ollama/")) {
    return localFetch(`http://127.0.0.1:11434/${path.slice("/ollama/".length)}`, init);
  }
  return localFetch(input, init);
};

const skill = await readFile(new URL("../skills/task-planning/SKILL.md", import.meta.url), "utf8");
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const nextMonday = new Date(today);
nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
const nextFriday = new Date(today);
nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
const dateOnly = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const result = await taskPlanningService.process({
  text: "Need to go to the dentist on Monday. Will have to finish the financial planning for Tesco latest by tomorrow",
  history: [],
  skillInstructions: skill,
  allowMockFallback: false,
});

assert.equal(result.kind, "task-proposal", result.kind === "task-proposal" ? "" : result.text);
assert.equal(result.provider, "local-llm");
assert.equal(result.proposal.tasks.length, 2, `the two independent commitments should become two tasks; got ${JSON.stringify(result.proposal.tasks)}`);
assert.ok(result.proposal.tasks.some((task) => /dentist/i.test(task.title) && task.proposedDueDate === dateOnly(nextMonday)), `dentist reminder should be due ${dateOnly(nextMonday)}; got ${JSON.stringify(result.proposal.tasks)}`);
assert.ok(result.proposal.tasks.some((task) => /financial|planning|tesco/i.test(`${task.title} ${task.description}`) && task.proposedDueDate === dateOnly(tomorrow)), `Tesco financial planning should be due ${dateOnly(tomorrow)}; got ${JSON.stringify(result.proposal.tasks)}`);

const mixedResult = await taskPlanningService.process({
  text: "Need to chase Peter for the financial analysis. Book the dentist appointment for Thursday. Also need to prepare for client presentation on 30th",
  history: [],
  skillInstructions: skill,
  allowMockFallback: false,
});
assert.equal(mixedResult.kind, "task-proposal", mixedResult.kind === "task-proposal" ? "" : mixedResult.text);
assert.equal(mixedResult.proposal.tasks.length, 3, `the three independent actions should become three tasks; got ${JSON.stringify(mixedResult.proposal.tasks)}`);
const thursday = new Date(today);
thursday.setDate(thursday.getDate() + ((4 - thursday.getDay() + 7) % 7 || 7));
const thirtieth = new Date(today.getFullYear(), today.getMonth(), 30);
const presentationDate = thirtieth < today ? new Date(today.getFullYear(), today.getMonth() + 1, 30) : thirtieth;
assert.ok(mixedResult.proposal.tasks.some((task) => /dentist/i.test(`${task.title} ${task.description}`) && task.proposedDueDate === dateOnly(thursday)), `dentist task should be due ${dateOnly(thursday)}; got ${JSON.stringify(mixedResult.proposal.tasks)}`);
assert.ok(mixedResult.proposal.tasks.some((task) => /presentation/i.test(`${task.title} ${task.description}`) && task.proposedDueDate === dateOnly(presentationDate)), `presentation task should be due ${dateOnly(presentationDate)}; got ${JSON.stringify(mixedResult.proposal.tasks)}`);
assert.ok(mixedResult.proposal.tasks.some((task) => /Peter/i.test(`${task.title} ${task.description}`)), `Peter follow-up should be a separate task; got ${JSON.stringify(mixedResult.proposal.tasks)}`);

const omittedClauseResult = await taskPlanningService.process({
  text: "Ask Peter for the final draft by end of tomorrow. Analyse the content and prepar for client meeting on friday",
  history: [],
  skillInstructions: skill,
  allowMockFallback: false,
});
assert.equal(omittedClauseResult.kind, "task-proposal", omittedClauseResult.kind === "task-proposal" ? "" : omittedClauseResult.text);
assert.equal(omittedClauseResult.proposal.tasks.length, 2, `both independent outcomes should be proposed; got ${JSON.stringify(omittedClauseResult.proposal.tasks)}`);
assert.ok(omittedClauseResult.proposal.tasks.some((task) => /Peter/i.test(`${task.title} ${task.description}`) && task.proposedDueDate === dateOnly(tomorrow)), `Peter request should be due ${dateOnly(tomorrow)}; got ${JSON.stringify(omittedClauseResult.proposal.tasks)}`);
assert.ok(omittedClauseResult.proposal.tasks.some((task) => /content|meeting/i.test(`${task.title} ${task.description}`) && task.proposedDueDate === dateOnly(nextFriday)), `content analysis/meeting preparation should be due ${dateOnly(nextFriday)}; got ${JSON.stringify(omittedClauseResult.proposal.tasks)}`);
console.log("PASS: local Llama represented all actionable clauses from the mixed prompts and grounded their explicit due dates.");
