import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const certDir = resolve(homedir(), ".office-addin-dev-certs");

export default defineConfig(({ command }) => ({
  plugins: [react()],
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
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
    },
  } : undefined,
}));
