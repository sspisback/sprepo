import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, extname, basename, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import Busboy from "busboy";
import { connect, type Connection } from "@lancedb/lancedb";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as typeof import("pdf-parse");

const projectRoot = process.cwd();
const dataRoot = resolve(projectRoot, "data");
const uploadRoot = resolve(dataRoot, "uploads");
const vectorRoot = resolve(dataRoot, "vectors");
const sampleRoot = resolve(projectRoot, "samples", "knowledge");
const tableName = "document_chunks";
const embeddingModel = "nomic-embed-text";
const maxUploadBytes = (() => {
  const configuredMb = Number(process.env.BRAIN_MAX_UPLOAD_MB ?? "10");
  const safeMb = Number.isFinite(configuredMb) ? Math.min(50, Math.max(1, configuredMb)) : 10;
  return Math.floor(safeMb * 1024 * 1024);
})();
const maxExtractedChars = 2_000_000;
const chunkSize = 1_100;
const chunkOverlap = 180;

type DocumentType = "pdf" | "docx" | "txt";
type ExtractedPage = { text: string; pageNumber: number | null };
type TextChunk = { text: string; pageNumber: number | null; section: string };
type DocumentRow = {
  documentId: string;
  filename: string;
  uploadedAt: string;
  fileType: string;
  chunkId: string;
  pageNumber: number;
  section: string;
  originalFileLocation: string;
  sha256: string;
  text: string;
  vector: number[];
};
type StoredDocument = {
  documentId: string;
  filename: string;
  uploadedAt: string;
  fileType: DocumentType;
  chunkCount: number;
  originalFileLocation: string;
  sha256: string;
};
type UploadPayload = { filename: string; mimeType: string; buffer: Buffer };

let databasePromise: Promise<Connection> | undefined;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function fail(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

function safeFilename(input: string): string {
  const onlyName = basename(input.replaceAll("\\", "/"));
  const cleaned = onlyName.replace(/[^\p{L}\p{N}_.() -]/gu, "_").replace(/^\.+/, "").trim().slice(0, 160);
  return cleaned || "uploaded-document";
}

function fileTypeFor(filename: string): DocumentType | null {
  const extension = extname(filename).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".txt") return "txt";
  return null;
}

function isZipBomb(buffer: Buffer): boolean {
  // A DOCX is a ZIP archive. Inspect its central directory before Mammoth
  // expands it, and reject archives with implausibly large uncompressed data.
  const lowerBound = Math.max(0, buffer.length - 65_557);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endRecord = offset; break; }
  }
  if (endRecord < 0 || endRecord + 22 > buffer.length) return true;
  const entries = buffer.readUInt16LE(endRecord + 10);
  const centralOffset = buffer.readUInt32LE(endRecord + 16);
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) return true;
    totalUncompressed += buffer.readUInt32LE(cursor + 24);
    if (totalUncompressed > 25 * 1024 * 1024) return true;
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return false;
}

async function parseUpload(request: IncomingMessage): Promise<UploadPayload> {
  return new Promise((resolvePayload, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({ headers: request.headers, limits: { files: 1, fileSize: maxUploadBytes, fields: 4 } });
    } catch {
      reject(new Error("Upload must use a multipart form with one document file."));
      return;
    }
    let payload: UploadPayload | null = null;
    let fileTooLarge = false;
    let parseError: Error | null = null;
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "file") { stream.resume(); return; }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => { fileTooLarge = true; });
      stream.on("error", (error: Error) => { parseError = error; });
      stream.on("end", () => {
        payload = { filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) };
      });
    });
    parser.on("filesLimit", () => { parseError = new Error("Upload one document at a time."); });
    parser.on("error", reject);
    parser.on("close", () => {
      if (fileTooLarge) { reject(new Error(`The file exceeds the ${Math.floor(maxUploadBytes / 1024 / 1024)} MB limit.`)); return; }
      if (parseError) { reject(parseError); return; }
      if (!payload?.buffer.length) { reject(new Error("Choose a non-empty PDF, DOCX, or TXT file.")); return; }
      resolvePayload(payload);
    });
    request.pipe(parser);
  });
}

async function getDatabase(): Promise<Connection> {
  await mkdir(uploadRoot, { recursive: true });
  await mkdir(vectorRoot, { recursive: true });
  databasePromise ??= connect(vectorRoot);
  return databasePromise;
}

async function getTable() {
  const database = await getDatabase();
  const names = await database.tableNames();
  return names.includes(tableName) ? database.openTable(tableName) : null;
}

async function embed(inputs: string[], prefix: "search_document" | "search_query"): Promise<number[][]> {
  const response = await fetch("http://127.0.0.1:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, input: inputs.map((text) => `${prefix}: ${text}`), truncate: true }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (/not found|pull/i.test(detail)) throw new Error(`Ollama embedding model '${embeddingModel}' is not installed. Run: ollama pull ${embeddingModel}`);
    throw new Error(`Ollama embeddings failed (HTTP ${response.status}). Check that Ollama is running.`);
  }
  const payload = await response.json() as { embeddings?: unknown };
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== inputs.length
    || payload.embeddings.some((vector) => !Array.isArray(vector) || vector.length === 0 || vector.some((value) => typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error("Ollama returned invalid or incomplete embeddings.");
  }
  return payload.embeddings as number[][];
}

function splitIntoChunks(pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const page of pages) {
    const paragraphs = page.text.replace(/\r/g, "").split(/\n+/).map((part) => part.trim()).filter(Boolean);
    let section = "";
    let current = "";
    const flush = () => {
      const text = current.trim();
      if (text) chunks.push({ text, pageNumber: page.pageNumber, section });
      current = text ? text.slice(-chunkOverlap) : "";
    };
    for (const paragraph of paragraphs) {
      const markdownHeading = paragraph.match(/^#{1,6}\s+(.{2,100})$/);
      const looksLikeHeading = paragraph.length <= 100 && (Boolean(markdownHeading) || /^[A-Z0-9][A-Z0-9 &/()'-]{3,}$/.test(paragraph));
      if (looksLikeHeading) {
        if (current.length > 300) flush();
        section = (markdownHeading?.[1] ?? paragraph).trim();
        continue;
      }
      let remaining = paragraph;
      while (remaining.length) {
        if (current.length >= chunkSize) flush();
        const space = Math.max(1, chunkSize - current.length);
        const lastSpace = remaining.lastIndexOf(" ", space);
        const sliceAt = remaining.length <= space ? remaining.length : lastSpace > 0 ? lastSpace : space;
        current = `${current}${current ? "\n" : ""}${remaining.slice(0, sliceAt).trim()}`;
        remaining = remaining.slice(sliceAt).trim();
        if (remaining.length && current.length >= chunkSize - chunkOverlap) flush();
      }
      if (current.length >= chunkSize) flush();
    }
    const last = current.trim();
    if (last) chunks.push({ text: last, pageNumber: page.pageNumber, section });
  }
  return chunks.filter((chunk) => chunk.text.length > 0).slice(0, 5000);
}

async function extractDocument(type: DocumentType, buffer: Buffer): Promise<ExtractedPage[]> {
  if (type === "txt") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { throw new Error("TXT files must be valid UTF-8 text."); }
    return [{ text, pageNumber: null }];
  }
  if (type === "docx") {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50 || isZipBomb(buffer)) throw new Error("This file is not a valid, safely sized DOCX document.");
    const extracted = await mammoth.extractRawText({ buffer });
    return [{ text: extracted.value, pageNumber: null }];
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("This file does not have a valid PDF signature.");
  const pageTexts = new Map<number, string>();
  const parsed = await pdfParse(buffer, {
    max: 2000,
    pagerender: async (page) => {
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pageTexts.set(typeof page.pageNumber === "number" ? page.pageNumber : pageTexts.size + 1, text);
      return text;
    },
  });
  if (pageTexts.size) return [...pageTexts.entries()].sort(([left], [right]) => left - right).map(([pageNumber, text]) => ({ text, pageNumber }));
  return parsed.text.split("\f").map((text, index) => ({ text, pageNumber: index + 1 }));
}

async function readTableRows() {
  const table = await getTable();
  if (!table) return [];
  return table.query().select(["documentId", "filename", "uploadedAt", "fileType", "chunkId", "pageNumber", "section", "originalFileLocation", "sha256"]).limit(200_000).toArray() as Promise<Array<Record<string, unknown>>>;
}

async function listDocuments(): Promise<StoredDocument[]> {
  const rows = await readTableRows();
  const documents = new Map<string, StoredDocument>();
  for (const row of rows) {
    const id = String(row.documentId ?? "");
    if (!id) continue;
    const current = documents.get(id);
    if (current) { current.chunkCount += 1; continue; }
    documents.set(id, {
      documentId: id,
      filename: String(row.filename ?? ""),
      uploadedAt: String(row.uploadedAt ?? ""),
      fileType: String(row.fileType ?? "txt") as DocumentType,
      chunkCount: 1,
      originalFileLocation: String(row.originalFileLocation ?? ""),
      sha256: String(row.sha256 ?? ""),
    });
  }
  return [...documents.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

async function addDocument(payload: UploadPayload): Promise<{ document: StoredDocument; duplicate: boolean }> {
  const filename = safeFilename(payload.filename);
  const fileType = fileTypeFor(filename);
  if (!fileType) throw new Error("Unsupported file type. Upload a PDF, DOCX, or TXT file.");
  if (payload.buffer.length > maxUploadBytes) throw new Error(`The file exceeds the ${Math.floor(maxUploadBytes / 1024 / 1024)} MB limit.`);
  const sha256 = createHash("sha256").update(payload.buffer).digest("hex");
  const documents = await listDocuments();
  const duplicate = documents.find((document) => document.sha256 === sha256);
  if (duplicate) return { document: duplicate, duplicate: true };

  const pages = await extractDocument(fileType, payload.buffer);
  const extractedLength = pages.reduce((total, page) => total + page.text.length, 0);
  if (extractedLength > maxExtractedChars) throw new Error("The document contains too much extractable text for this local prototype (2 MB limit).");
  const chunks = splitIntoChunks(pages);
  if (!chunks.length || !chunks.some((chunk) => chunk.text.trim())) {
    throw new Error(fileType === "pdf"
      ? "No selectable text was found in this PDF. It may be scanned or image-only; OCR is not enabled in this prototype."
      : "No text could be extracted from this document.");
  }
  if (chunks.length >= 5000) throw new Error("The document produces too many chunks for a single local indexing operation.");

  const documentId = randomUUID();
  const uploadedAt = new Date().toISOString();
  const diskFilename = `${documentId}.${fileType}`;
  const originalFileLocation = resolve(uploadRoot, diskFilename);
  await writeFile(originalFileLocation, payload.buffer, { flag: "wx" });
  try {
    const vectors: number[][] = [];
    for (let start = 0; start < chunks.length; start += 32) {
      const batch = chunks.slice(start, start + 32);
      vectors.push(...await embed(batch.map((chunk) => chunk.text), "search_document"));
    }
    const rows: DocumentRow[] = chunks.map((chunk, index) => ({
      documentId,
      filename,
      uploadedAt,
      fileType,
      chunkId: `${documentId}:${index}`,
      pageNumber: chunk.pageNumber ?? -1,
      section: chunk.section,
      originalFileLocation,
      sha256,
      text: chunk.text,
      vector: vectors[index],
    }));
    const database = await getDatabase();
    const names = await database.tableNames();
    if (names.includes(tableName)) await (await database.openTable(tableName)).add(rows);
    else await database.createTable(tableName, rows);
  } catch (error) {
    await rm(originalFileLocation, { force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : "Local indexing failed.";
    throw new Error(detail.includes("fetch failed") || detail.includes("timed out")
      ? `Could not generate local embeddings. Ensure Ollama is running and run 'ollama pull ${embeddingModel}'. ${detail}`
      : detail);
  }
  return {
    duplicate: false,
    document: { documentId, filename, uploadedAt, fileType, chunkCount: chunks.length, originalFileLocation, sha256 },
  };
}

async function deleteDocument(documentId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) throw new Error("Invalid document ID.");
  const documents = await listDocuments();
  const document = documents.find((item) => item.documentId === documentId);
  if (!document) throw new Error("This document is not indexed.");
  const table = await getTable();
  if (table) await table.delete(`documentId = '${documentId}'`);
  const expectedPath = resolve(uploadRoot, `${documentId}.${document.fileType}`);
  if (resolve(document.originalFileLocation) === expectedPath) await rm(expectedPath, { force: true });
}

async function searchKnowledge(query: string): Promise<Array<Record<string, unknown>>> {
  const table = await getTable();
  if (!table) return [];
  const [vector] = await embed([query], "search_query");
  const rows = await table.vectorSearch(vector).distanceType("cosine").limit(8).toArray() as Array<Record<string, unknown>>;
  // LanceDB cosine distance is lower for closer matches; reject weak matches
  // so unrelated files are not presented as evidence for the answer.
  return rows.filter((row) => typeof row._distance === "number" && Number(row._distance) <= 0.4)
    .map((row) => ({
      documentId: String(row.documentId),
      filename: String(row.filename),
      chunkId: String(row.chunkId),
      pageNumber: typeof row.pageNumber === "number" && Number(row.pageNumber) > 0 ? Number(row.pageNumber) : null,
      section: String(row.section ?? "") || null,
      excerpt: String(row.text),
      similarity: Math.max(-1, Math.min(1, 1 - Number(row._distance))),
      uploadedAt: String(row.uploadedAt),
    }));
}

async function ollamaStatus(): Promise<{ running: boolean; embeddingModel: string; modelInstalled: boolean }> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { running: false, embeddingModel, modelInstalled: false };
    const data = await response.json() as { models?: Array<{ name?: string }> };
    const modelInstalled = Boolean(data.models?.some((model) => model.name === embeddingModel || model.name?.startsWith(`${embeddingModel}:`)));
    return { running: true, embeddingModel, modelInstalled };
  } catch {
    return { running: false, embeddingModel, modelInstalled: false };
  }
}

async function importSamples(): Promise<Array<{ filename: string; duplicate: boolean }>> {
  await mkdir(sampleRoot, { recursive: true });
  const names = await readdir(sampleRoot);
  const imported: Array<{ filename: string; duplicate: boolean }> = [];
  for (const name of names.sort()) {
    const type = fileTypeFor(name);
    if (!type || name.startsWith(".")) continue;
    const filePath = resolve(sampleRoot, name);
    if (!filePath.startsWith(`${sampleRoot}${sep}`)) continue;
    const info = await lstat(filePath);
    if (!info.isFile() || info.size > maxUploadBytes) continue;
    const result = await addDocument({ filename: name, mimeType: "application/octet-stream", buffer: await readFile(filePath) });
    imported.push({ filename: result.document.filename, duplicate: result.duplicate });
  }
  return imported;
}

export async function handleKnowledgeRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/knowledge/")) return false;

  try {
    if (request.method === "GET" && pathname === "/api/knowledge/status") {
      sendJson(response, 200, { ...(await ollamaStatus()), maxUploadMb: Math.floor(maxUploadBytes / 1024 / 1024) });
      return true;
    }
    if (request.method === "GET" && pathname === "/api/knowledge/documents") {
      sendJson(response, 200, { documents: await listDocuments() });
      return true;
    }
    if (request.method === "GET" && pathname === "/api/knowledge/skill") {
      const content = await readFile(resolve(projectRoot, "skills", "knowledge.md"), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/markdown; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(content);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/knowledge/upload") {
      const payload = await parseUpload(request);
      const result = await addDocument(payload);
      sendJson(response, result.duplicate ? 200 : 201, result);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/knowledge/search") {
      const body = await readRequestJson(request) as { query?: unknown };
      if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 2000) { fail(response, 400, "Enter a question of 1–2,000 characters."); return true; }
      sendJson(response, 200, { results: await searchKnowledge(body.query.trim()) });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/knowledge/import-samples") {
      sendJson(response, 200, { imported: await importSamples() });
      return true;
    }
    const deleteMatch = pathname.match(/^\/api\/knowledge\/documents\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      await deleteDocument(decodeURIComponent(deleteMatch[1]));
      sendJson(response, 200, { deleted: true });
      return true;
    }
    fail(response, 404, "Knowledge endpoint not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local document processing failed.";
    const status = /unsupported|must use|choose|exceeds|valid|empty|too much|too many|invalid|scanned|no selectable/i.test(message) ? 400 : 500;
    fail(response, status, message);
  }
  return true;
}

function readRequestJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 16_384) reject(new Error("Request is too large."));
    });
    request.on("end", () => {
      try { resolveBody(JSON.parse(body)); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    request.on("error", reject);
  });
}
