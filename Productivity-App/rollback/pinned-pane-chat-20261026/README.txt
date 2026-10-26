Rollback for the pinned pane and email-context changes

Restore these files from this folder to the project root:
- manifest.xml -> manifest.xml
- App.tsx -> src/App.tsx
- styles.css -> src/styles.css
- llmService.ts -> src/llmService.ts

PowerShell restore command from the project root:
Copy-Item rollback\pinned-pane-chat-20261026\manifest.xml manifest.xml -Force
Copy-Item rollback\pinned-pane-chat-20261026\App.tsx src\App.tsx -Force
Copy-Item rollback\pinned-pane-chat-20261026\styles.css src\styles.css -Force
Copy-Item rollback\pinned-pane-chat-20261026\llmService.ts src\llmService.ts -Force

These snapshots are from immediately before this feature change. The folder can be removed after deciding to keep the feature.
