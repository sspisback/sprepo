import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const maxAudioBytes = 20 * 1024 * 1024;
const maxSpeechChars = 6_000;
const tempRoot = resolve(tmpdir(), "brain-assistant-voice");

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function config() {
  return {
    whisper: process.env.WHISPER_CPP_PATH,
    whisperModel: process.env.WHISPER_MODEL_PATH,
    piper: process.env.PIPER_PATH,
    piperModel: process.env.PIPER_MODEL_NAME,
    piperDataDir: process.env.PIPER_DATA_DIR,
  };
}

async function exists(path?: string): Promise<boolean> {
  if (!path) return false;
  try { await access(path); return true; } catch { return false; }
}

function run(executable: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-200_000); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not start the configured local speech program: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(stderr.trim() || `The local speech program exited with code ${code ?? "unknown"}.`));
      else resolveOutput(stdout);
    });
    child.stdin.end(options.input ?? "");
  });
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > limit) throw new Error(`The upload exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`);
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const data = await readBody(request, 32_000);
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON."); }
}

function validWav(data: Buffer): boolean {
  return data.length >= 44 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE"
    && data.readUInt16LE(20) === 1 && data.readUInt16LE(22) === 1 && data.readUInt32LE(24) === 16_000
    && data.readUInt16LE(34) === 16;
}

async function transcribe(request: IncomingMessage): Promise<string> {
  const { whisper, whisperModel } = config();
  if (!(await exists(whisper)) || !(await exists(whisperModel))) {
    throw new Error("Whisper.cpp is not configured. Set WHISPER_CPP_PATH and WHISPER_MODEL_PATH to the local whisper-cli.exe and small.en model files, then restart the development server.");
  }
  const audio = await readBody(request, maxAudioBytes);
  if (!validWav(audio)) throw new Error("The recording must be mono, 16-bit, 16 kHz WAV audio.");
  await mkdir(tempRoot, { recursive: true });
  const id = randomUUID();
  const inputPath = resolve(tempRoot, `${id}.wav`);
  const outputBase = resolve(tempRoot, `${id}-transcript`);
  try {
    await writeFile(inputPath, audio, { flag: "wx" });
    await run(whisper!, ["-m", whisperModel!, "-f", inputPath, "-l", "en", "-nt", "-otxt", "-of", outputBase], { timeoutMs: 180_000 });
    const transcript = (await readFile(`${outputBase}.txt`, "utf8")).trim();
    if (!transcript) throw new Error("Whisper did not detect any speech. Try speaking closer to the microphone.");
    return transcript.slice(0, 2_000);
  } finally {
    await rm(inputPath, { force: true }).catch(() => undefined);
    await rm(`${outputBase}.txt`, { force: true }).catch(() => undefined);
  }
}

async function synthesize(text: string): Promise<Buffer> {
  const { piper, piperModel, piperDataDir } = config();
  const modelFile = piperModel && piperDataDir ? resolve(piperDataDir, `${piperModel}.onnx`) : undefined;
  if (!(await exists(piper)) || !piperModel || !(await exists(piperDataDir)) || !(await exists(modelFile))) {
    throw new Error("Piper is not configured. Set PIPER_PATH, PIPER_MODEL_NAME, and PIPER_DATA_DIR to the local Piper CLI and voice model, then restart the development server.");
  }
  await mkdir(tempRoot, { recursive: true });
  const outputPath = resolve(tempRoot, `${randomUUID()}.wav`);
  const args = ["-m", piperModel!, "--data-dir", piperDataDir!, "-f", outputPath, "--", text];
  try {
    await run(piper!, args, { timeoutMs: 120_000 });
    const audio = await readFile(outputPath);
    if (audio.length < 44 || audio.length > maxAudioBytes) throw new Error("Piper produced an invalid or oversized audio response.");
    return audio;
  } finally {
    await rm(outputPath, { force: true }).catch(() => undefined);
  }
}

export async function handleVoiceRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/voice/")) return false;
  try {
    if (request.method === "GET" && url.pathname === "/api/voice/status") {
      const settings = config();
      sendJson(response, 200, {
        sttAvailable: await exists(settings.whisper) && await exists(settings.whisperModel),
        ttsAvailable: await exists(settings.piper) && Boolean(settings.piperModel) && await exists(settings.piperDataDir)
          && await exists(resolve(settings.piperDataDir!, `${settings.piperModel}.onnx`)),
      });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/voice/transcribe") {
      sendJson(response, 200, { text: await transcribe(request) });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/voice/speak") {
      const payload = await readJson(request) as { text?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > maxSpeechChars) {
        sendJson(response, 400, { error: `Spoken text must be 1–${maxSpeechChars} characters.` });
        return true;
      }
      const audio = await synthesize(payload.text.trim());
      response.statusCode = 200;
      response.setHeader("Content-Type", "audio/wav");
      response.setHeader("Content-Length", audio.length);
      response.setHeader("Cache-Control", "no-store");
      response.end(audio);
      return true;
    }
    sendJson(response, 404, { error: "Voice endpoint not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local speech processing failed.";
    const status = /exceeds|must be|valid json|mono, 16-bit|must contain/i.test(message) ? 400 : /not configured/i.test(message) ? 503 : 500;
    sendJson(response, status, { error: message });
  }
  return true;
}
