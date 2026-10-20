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

## Try the chat

Select **Summarise Email** above the message box to retrieve the sample email in Browser Mock Mode or the currently open email in Outlook Live Mode, then generate a local model summary. The sender, received date, and subject come from the email service; only the body is sent to Ollama. The text box remains available for other questions and continues to use simulated replies. Enter sends, Shift+Enter adds a line break, and New chat clears the current in-memory conversation.

## Local Ollama summaries

This project uses the locally installed `llama3.2:3b` model through Ollama's local chat API. The browser calls the same-origin `/ollama/api/chat` route over the existing HTTPS app URL; the Vite development server proxies that request to `http://127.0.0.1:11434`. No separate backend package or cloud service is used. The proxy is available only while the local Vite development server is running.

The model is already installed on this laptop. To check it from PowerShell when the `ollama` command isn't on `PATH`, run:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list
```

If the model is missing, download it with:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" pull llama3.2:3b
```

Start Ollama from the Windows Start menu if its local API is not running. Then start the app with `npm.cmd run dev-server` and open `https://localhost:3000`. In Browser Mock Mode, **Summarise Email** sends the built-in synthetic sample email to the local model. The Outlook Live path is implemented, but has not been tested with a real email as part of this integration work. Follow company policy before processing real client email, even when inference stays on this computer.

The button shows a spinner while the model is working, prevents repeat submissions, and reports connection, model, or timeout errors. A failed model request never produces a made-up replacement summary. Email text is treated as untrusted content in the model prompt, not as instructions.

## Stop and restart

- Stop the server with **Ctrl+C** in its terminal.
- Stop the Outlook add-in debugging registration with `npm.cmd run stop`.
- To resume development, run `npm.cmd run dev-server` and, if needed, `npm.cmd start` in another window.

## Permissions and limitations

Outlook Live Mode reads only the currently open message, using `ReadItem`. If Outlook does not expose the item fields, the app displays an error and never silently substitutes sample data. Browser Mock Mode uses the hardcoded sample. When the user requests a summary, the message body is sent to Ollama on this computer; do not process real client email until local processing is approved under company policy.
