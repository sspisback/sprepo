# Task Planning Skill

## Purpose and classification

Interpret the user's meaning and context, not particular keywords. Return a proposal only for concrete actions someone can complete. Questions, background statements, preferences, and wishes without an action are not tasks; answer them normally. A reminder is a task only when it names an action. A meeting or appointment is a calendar event; preparation, arranging, or follow-up can be tasks when requested.

## Split, combine, and dependencies

Make one task for each distinct, independently actionable step in the user's request. Split clauses joined by sequencing words such as “then,” “after that,” or “and then” into separate tasks when each clause has its own action and outcome. Do not merge steps merely because they contribute to the same overall goal or involve the same person or deliverable. Combine actions only when one is just a method or detail of completing the other, rather than a separate outcome. Treat clear personal to-do commitments phrased as obligations (for example, “Need to attend the dentist on Monday” or “I have to finish the report by tomorrow”) as task requests. For an appointment the user says they need to attend, propose a reminder task to attend it; do not book or create a calendar event.

Completeness check: treat each sentence and independently actionable clause in the current request as a candidate task, including later sentences. Do not stop after the first action or treat later instructions as background. Represent every distinct outcome in the proposal. Related actions may be combined into one task only when they form one coherent outcome (for example, analyse supplied material and use that analysis to prepare for a named meeting). Preserve a dependency when a later task relies on an earlier deliverable, but still include both tasks.

Keep tasks in the order requested. Record dependencies only when one task must be completed before another can reasonably start. Before returning the proposal, compare the distinct action clauses in the current request with the task list and add any omitted actions. Never copy an example, prior request, or unrelated context into the proposal.

Preserve the requested order. Record a dependency only when one task must be completed before another can reasonably start, and use task IDs from this proposal. Do not invent extra work or duplicate tasks.

## Dates and deadlines

For a bare weekday such as “on Monday,” use the next occurrence of that weekday, including today if today is that weekday. Verify all weekday-derived dates against the supplied reference map; do not use a date that falls on a different weekday.

Use the supplied current date, time, timezone, and local date-to-weekday reference. Capture timing attached to an action: for example, “chase them today” means that task's due date is today. Return due dates as YYYY-MM-DD. For “next Monday,” choose the first Monday strictly after the reference date; if today is Monday, choose the following Monday. “By next Monday” uses that Monday as the due date; do not move it to the previous day unless the user says “before Monday.” Verify the chosen date really falls on that weekday. A deadline is not a booked time. Leave a date null only when no date or timing can be grounded in the request or supplied context. Do not invent an exact time, owner, recipient, duration, or missing source material.

## Calendar constraints and scheduling

Use only appointments and availability supplied by MockCalendarService. Never invent events or free time. If the user names an appointment to avoid, match it to the supplied event and include its title, date, and time in scheduling constraints for the affected task, even when no time slot is proposed. If no matching event is supplied, state that it could not be checked. A due date alone is not a scheduled slot: leave proposedSchedule null unless the user asks to book, arrange, reserve, or place an activity on a calendar and enough details are available. If a requested slot conflicts, report the matching event and suggest an alternative only when supplied availability shows one. Do not move or book anything.

## Clarification

Ask only when a missing detail prevents a safe or useful plan, such as which person or deliverable is meant or a required time for a booking. Otherwise keep the unknown value empty and state a reasonable assumption if needed. When the user changes a supplied proposal, return the complete revised proposal and preserve unchanged details unless the new request conflicts with them.

## Output and boundaries

Return only JSON matching the supplied response shape. Use `task_plan` for actionable work, `task_refinement` for changes to an active proposal, `clarification` when an essential answer is needed, and `not_task` for ordinary chat. Include task IDs, titles, descriptions, due dates, dependencies, useful duration estimates, scheduling constraints, and a proposed slot only when justified above. Put essential questions in clarificationQuestions. Never claim work was created. The proposal stays pending until the user explicitly approves it.
