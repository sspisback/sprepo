import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const certDir = resolve(homedir(), ".office-addin-dev-certs");
const taskSkillPath = resolve(process.cwd(), "skills", "task-planning", "SKILL.md");
const emailSummarySkillPath = resolve(process.cwd(), "skills", "email-summarisation", "summarise.md");
const prioritySkillPath = resolve(process.cwd(), "skills", "priority.md");
const orchestratorSkillPath = resolve(process.cwd(), "skills", "orchestrator.md");
const meetingSkillPath = resolve(process.cwd(), "skills", "meeting.md");
const researchSkillPath = resolve(process.cwd(), "skills", "research.md");
const assistantSkillPaths: Record<string, string> = {
  "/api/orchestrator/skill": orchestratorSkillPath,
  "/api/meeting/skill": meetingSkillPath,
  "/api/research/skill": researchSkillPath,
  "/api/task-planning/skill": taskSkillPath,
  "/api/email-summarisation/skill": emailSummarySkillPath,
  "/api/priority/skill": prioritySkillPath,
};

function assistantSkillLoader(): Plugin {
  return {
    name: "brain-assistant-skill-loader",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        const skillPath = pathname ? assistantSkillPaths[pathname] : null;
        if (!skillPath) {
          next();
          return;
        }
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET");
          response.end("Method not allowed");
          return;
        }
        void readFile(skillPath, "utf8").then((skill) => {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/markdown; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(skill);
        }).catch((error: unknown) => {
          server.config.logger.error(`Could not load assistant skill '${pathname}': ${String(error)}`);
          response.statusCode = 500;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Assistant skill file could not be loaded.");
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), assistantSkillLoader()],
  server: command === "serve" ? {
    port: 3000,
    strictPort: true,
    https: {
      key: readFileSync(resolve(certDir, "localhost.key")),
      cert: readFileSync(resolve(certDir, "localhost.crt")),
      ca: readFileSync(resolve(certDir, "ca.crt")),
    },
    proxy: {
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
        timeout: 360_000,
        proxyTimeout: 360_000,
      },
    },
  } : undefined,
}));
