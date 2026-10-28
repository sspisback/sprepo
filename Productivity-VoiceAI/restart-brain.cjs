const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const port = 3000;
const pidFile = path.join(os.tmpdir(), "brain-assistant-vite-manager.pid");
const appDirectory = __dirname;

function findListenerPids() {
  const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/i);
    if (match && match[1].endsWith(`:${port}`)) pids.add(Number(match[3]));
  }
  return [...pids];
}

function requestBrainStatus() {
  return new Promise((resolve) => {
    const request = https.get({
      hostname: "localhost",
      port,
      path: "/api/voice/status",
      rejectUnauthorized: false,
      timeout: 5000,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const status = JSON.parse(body);
          resolve(response.statusCode === 200
            && typeof status.sttAvailable === "boolean"
            && typeof status.ttsAvailable === "boolean");
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function isBrainResponding() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await requestBrainStatus()) return true;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

async function isPortAcceptingConnections() {
  return (await canConnect("127.0.0.1")) || (await canConnect("::1"));
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readTrackedManagerPid() {
  try {
    const record = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    return Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null;
  } catch {
    return null;
  }
}

function removePidFileIfOwnedBy(pidToRemove) {
  try {
    if (readTrackedManagerPid() === pidToRemove) fs.unlinkSync(pidFile);
  } catch {}
}

function stopProcessTree(pid) {
  execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
}

async function waitUntilBrainStops() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (!(await isBrainResponding()) && !(await isPortAcceptingConnections())) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function stopExistingBrain() {
  console.log("Checking for an existing Brain server on port 3000...");
  const brainResponding = await isBrainResponding();
  const trackedPid = readTrackedManagerPid();

  if (trackedPid && processIsRunning(trackedPid) && brainResponding) {
    console.log(`Stopping the Brain server started by this launcher (process ${trackedPid})...`);
    stopProcessTree(trackedPid);
    removePidFileIfOwnedBy(trackedPid);
    if (!(await waitUntilBrainStops())) throw new Error("Brain did not stop cleanly; Vite was not restarted.");
    return;
  }

  const listenerPids = findListenerPids();
  if (listenerPids.length > 0) {
    if (!brainResponding) {
      throw new Error(`Port 3000 is used by process ${listenerPids.join(", ")}, but it did not identify as Brain. It was left running.`);
    }
    console.log(`Brain was found on port 3000 (process ${listenerPids.join(", ")}); stopping it...`);
    for (const pid of listenerPids) stopProcessTree(pid);
    if (!(await waitUntilBrainStops())) throw new Error("Brain did not stop cleanly; Vite was not restarted.");
    return;
  }

  if (brainResponding || await isPortAcceptingConnections()) {
    throw new Error("Port 3000 is responding, but Windows did not provide a process ID that can be safely stopped. Nothing was terminated.");
  }
}

function startVite() {
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { encoding: "utf8" });
  process.once("exit", () => removePidFileIfOwnedBy(process.pid));
  console.log("Starting Brain with the configured voice tools. Keep this window open while using Brain.");

  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd run dev-server"], {
    cwd: appDirectory,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });

  child.once("error", (error) => {
    console.error(`ERROR: Could not start npm.cmd: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    removePidFileIfOwnedBy(process.pid);
    if (signal) process.exitCode = 1;
    else process.exitCode = code ?? 1;
  });
}

async function main() {
  try {
    await stopExistingBrain();
    startVite();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
