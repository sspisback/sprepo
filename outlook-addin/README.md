# Brain Assistant for Outlook

A local prototype Outlook task pane built with React, TypeScript and Fluent UI. Browser Mock Mode uses sample email data. Outlook Live Mode reads only the currently open email when the user selects **Summarise Email**. Summaries use the locally installed Ollama model through the local development server; email content is not sent to an external service. The Office.js library is loaded from Microsoft's official Office Add-ins CDN as required by Outlook add-ins.

## Before you start

This manifest exposes the ribbon button on **opened messages in read mode**. It also enables Outlook's **no item context** feature on classic Outlook builds that support Mailbox requirement set 1.13, so the pane can open without a selected message. Microsoft currently documents that new Outlook for Windows and Outlook on the web still require a selected message for this feature. Classic Outlook deployments commonly allow local sideloading through the Add-ins dialog; new Outlook availability depends on the account and organization policy. A company can disable custom add-ins or centralized deployment, in which case an administrator must allow or deploy this prototype. The local development setup cannot inspect your Outlook build or company policy.

Check your Outlook version in **File → Office Account → About Outlook** (classic) or **Settings → General → About Outlook** (new Outlook). If the sideload options described below are missing or blocked, ask your Microsoft 365 administrator whether custom Outlook add-ins and local development sideloading are allowed.

## Install and run locally

Use a current Node.js LTS installation. These commands deliberately use `npm.cmd` for Windows PowerShell compatibility.

```powershell
npm.cmd install
npm.cmd exec -- office-addin-dev-certs install
npm.cmd run validate-manifest
npm.cmd run build
npm.cmd run dev-server
```

The certificate command creates and trusts a local development certificate for `localhost`; Windows may show a trust prompt. If your organization blocks certificate installation, contact IT rather than changing the PowerShell execution policy. Keep the development server running while using the add-in. Its HTTPS URL is `https://localhost:3000`.

In another PowerShell window, sideload into desktop Outlook:

```powershell
npm.cmd start
```

This uses Microsoft's Office Add-in debugging tool to register `manifest.xml` with desktop Outlook. If the command cannot locate Outlook or is blocked, use the manual method below or ask IT about sideloading policy.

The debugging tool may prompt **“Allow localhost loopback for Microsoft Edge WebView?”**. Approve this only for local development; it allows Outlook's embedded browser to load the HTTPS app from this computer's `localhost` address.

On this managed Windows laptop, the loopback exemption was denied with **Access Denied** because it requires administrator rights. Without that exemption, the debugging tool warns that the Outlook task pane might not load localhost. If this happens on your machine, ask IT to allow the Office Add-in localhost loopback exemption; don't change execution policy. The automatic sideload tool may also open Microsoft 365 sign-in to register the add-in. For manual sideloading, use the same mailbox already signed in to Outlook at the sideload page below.

### Manual sideload

1. Open [the Outlook sideload page](https://aka.ms/olksideload) in a browser signed in to the same mailbox. In classic Outlook, **File → Info → Manage Add-ins** opens the same page.
2. In **My add-ins**, find **Custom Addins → Add a custom add-in → Add from File** and select this project's `manifest.xml`. (Microsoft no longer offers Add from URL for custom Outlook add-ins.)
3. If your organization's policy permits custom add-ins, Outlook makes the add-in available to supported desktop clients, including new and classic Outlook. Classic Outlook can take time to refresh the add-in list.
4. Open an email in read mode. Find **Brain Assistant** on the message ribbon and select it to open the task pane.

To apply manifest updates after installing an earlier version, remove the existing **Brain Assistant** entry from **My add-ins → Custom Addins** using its `…` menu, then add the updated `manifest.xml` again.

Microsoft documents both the command-line and manual sideload paths in [Sideload Outlook add-ins for testing](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing?tabs=windows). If the custom add-in option is unavailable, your organization may require administrator deployment.

## Email modes

- Open `https://localhost:3000` directly in Chrome or Edge to use **Mock Mode**. Office.js is optional; the app detects an Outlook host when available and otherwise uses the sample email.
- Open the task pane from a message in classic Outlook to use **Outlook Live**. The service requests data only from `Office.context.mailbox.item` for the current message.
- The manifest requests `ReadItem`, the least-privilege permission required to read the currently open message. It does not grant mailbox-wide read/write access.

## Editable email summarisation skill

The **Summarise Email** button loads [`skills/email-summarisation/summarise.md`](skills/email-summarisation/summarise.md) from the local development server on each click and passes its instructions to the existing local Ollama request. To edit the summarisation style or rules, open that Markdown file in VS Code and save it. The Vite server reads it from disk for the next summary request, so no manifest change or server restart is needed. The LLM receives the email body only; sender, received time and subject continue to come from the email service and are displayed separately by the UI. The generated summary is not sent to a MockService if Ollama is unavailable.

## Try the chat

Every message is sent to the local Llama model through Ollama when it is available. Brain keeps recent turns in memory for the current chat so follow-up questions can use the conversation. **Summarise Email** retrieves the sample message in Browser Mock Mode or the currently open message in Outlook Live Mode, then displays its sender, received time, subject, and a locally generated summary. The email body is retained in memory for email-related follow-ups such as "What should I reply?" and is included in a request only when the question appears to concern that message. The app checks the open Outlook item identity before using cached email context; when it changes, prior conversation context is cleared.

Enter sends; Shift+Enter inserts a line break. The visible conversation is saved in the task pane's local browser storage so it can be restored after the pane closes or reloads. This includes content shown in email summary/detail cards and task proposals. The separately cached email context used for follow-up requests is not persisted. **New chat** clears the saved conversation and cached email context. Storage is local to the browser or Outlook WebView profile for this app origin; it is not encrypted by the app or synchronized across devices, and browser/organization cleanup policies may remove it. The header shows **Local AI Connected** when Ollama and the configured model are available. Use **Retry** after starting Ollama if the status shows unavailable. If Ollama fails during a general question, Brain can use the existing simulated MockService; the response is clearly labeled **Mock Response**. Email summaries and email-specific answers are never generated by that fallback.

## Local Ollama chat

This project uses the locally installed `llama3.2:3b` model through Ollama's local chat API. The browser calls the same-origin `/ollama/api/chat` route over the existing HTTPS app URL; the Vite development server proxies that request to `http://127.0.0.1:11434`. A lightweight `/ollama/api/tags` check drives the status indicator. No separate backend package or cloud service is used. The proxy is available only while the local Vite development server is running.

The model is already installed on this laptop. To check it from PowerShell when the `ollama` command isn't on `PATH`, run:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list
```

If the model is missing, download it with:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" pull llama3.2:3b
```

Start Ollama from the Windows Start menu if its local API is not running. Then start the app with `npm.cmd run dev-server` and open `https://localhost:3000`. Browser Mock Mode uses a built-in synthetic email for the summary and follow-up tests. In Outlook Live Mode, the Outlook service reads only the open message. In both cases, inference stays on this computer. Use synthetic data until company policy approves local processing of real client email.

The chat shows a typing indicator while the model is working, prevents duplicate submissions, and reports connection, model, or timeout errors. Conversation history is bounded to recent turns, and email body context is length-limited before sending to the local model. Email text is treated as untrusted content in the model prompt, not as instructions. Email content and chat messages are not logged by the application.

## Task planning experiment

Task-related requests use the same local Llama model. Before each request, the app loads [`skills/task-planning/SKILL.md`](skills/task-planning/SKILL.md) from the local development server and includes those instructions, the current local date and timezone, a date-to-weekday reference, and fictional calendar data in the prompt. Edit that file to change planning guidance; changes are read on the next request without a server restart. TypeScript validates the returned JSON fields, dates, task IDs, and dependencies. The model decides whether a message is a task request, a refinement, a clarification, or ordinary chat.

The calendar and planner are simulations only. `MockCalendarService` supplies fictional appointments (including a Dentist appointment next Monday) and work-hour availability. `MockPlannerService` stores approved tasks in memory for the current page session and assigns `mock-task-0001` style IDs. Restarting or refreshing the app clears those mock tasks. No Microsoft Calendar, Planner, Graph, authentication, database, or external AI service is used.

### Standalone Microsoft Planner Graph client (not connected to the UI)

[`src/plannerGraphService.ts`](src/plannerGraphService.ts) is a separate Graph client prototype. It can list the signed-in user's tasks and plans, list buckets, and create a task in an existing basic Planner plan. It accepts a delegated access-token provider; it does not implement sign-in, store tokens, modify the manifest, or get called by the chat/task UI. Planner task creation requires delegated `Tasks.ReadWrite` consent and a plan/bucket the signed-in user can access. Graph's Planner API does not support premium plans.

The Graph endpoint was reachable from this machine. A live read request without a valid token returned HTTP 401 (`Access token is empty`); an invalid-token check through the new client also returned Graph's expected 401. This confirms network reachability and error handling only, not tenant sign-in, permission consent, plan access, or task creation. To complete an authorized test, an Entra app registration and your organization's approval/consent are needed. Do not paste access tokens or client secrets into chat or source files.

For a task request, Brain displays editable task cards in the conversation. Review the titles, descriptions, due dates, dependencies, scheduling constraints, and optional time slots. A due date is not a calendar booking. You can add, edit, or remove tasks; send a follow-up instruction to ask the local model to revise the pending proposal; or cancel. Only **Approve & Create Tasks** calls Mock Planner. A repeated approval with the same approval key is idempotent. Partial failures are reported as partial results.

### Test task planning

1. Start Ollama and the local app as described above. Confirm **Local AI Connected**.
2. Enter: `Need to chase James for the latest revenue report today, and then analyse it with client's proposal before presenting my recommendations to them by next Monday. Make sure it doesn't clash with the Dentist appointment I have on Monday.`
3. Wait for the local model to return a proposal, then inspect the mock calendar data and each task card. Correct any dates or constraints before approval. The current `llama3.2:3b` model can return structurally valid JSON while still misunderstanding relative deadlines or omitting a named calendar constraint; the app validates data shape and types, not the correctness of the model's interpretation.
4. Change a task, add or remove a task, or enter a refinement in chat. The latest plan supersedes the earlier proposal; only the current proposal can be approved.
5. Before approval, the Mock Planner task list is empty. Select **Approve & Create Tasks** to create simulated tasks. The confirmation shows the created titles and mock IDs. To verify the service directly during development, inspect `mockPlannerService.listCreatedTasks()` and `mockPlannerService.getInvocationCount()` in the browser debugger; the service is in-memory and the count is not shown as a production UI control.
6. Send a general question to check that ordinary chat continues to work. If Ollama is unavailable, ordinary chat can use the labeled MockService fallback, but task planning does not fabricate an LLM proposal.

The task cards and controls should be checked both in a browser at `https://localhost:3000` and in the Outlook task pane. This implementation was built and the manifest validated locally; semantic planning accuracy remains dependent on the installed local model, and the complex example above requires human review before approval.

### Test scenarios

1. Open `https://localhost:3000` in Chrome or Edge and confirm the header reports **Local AI Connected**.
2. Ask "What is the difference between revenue and profit?" then ask "Can you give me an example?" to check conversational follow-up.
3. Select **Summarise Email**. Browser mode uses its synthetic sample; Outlook mode uses only the currently open message.
4. Ask "What should I reply?" to check email context. In Outlook, open a different message and ask an email-related follow-up; Brain should clear the prior email context before answering.
5. Stop Ollama. The status should change to unavailable. General requests may show a clearly labeled **Mock Response**; email-dependent requests must report that no mock email analysis was created.
6. Restart Ollama, choose **Retry** or send a new message, and confirm local Llama responses resume.
7. Select **New chat** and confirm the conversation and cached email context are cleared.

The browser can validate real local chat and the built-in synthetic email. Outlook Live email retrieval must be tested in the Outlook task pane; do not use real client messages until company approval is in place.

## Stop and restart

- Stop the server with **Ctrl+C** in its terminal.
- Stop the Outlook add-in debugging registration with `npm.cmd run stop`.
- To resume development, run `npm.cmd run dev-server` and, if needed, `npm.cmd start` in another window.

## Permissions and limitations

Outlook Live Mode reads only the currently open message, using `ReadItem`. If Outlook does not expose the item fields, the app displays an error and never silently substitutes sample data. Browser Mock Mode uses the hardcoded sample. When the user requests a summary, the message body is sent to Ollama on this computer; do not process real client email until local processing is approved under company policy.
