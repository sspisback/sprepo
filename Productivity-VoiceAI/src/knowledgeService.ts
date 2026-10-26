export type KnowledgeDocument = {
  documentId: string;
  filename: string;
  uploadedAt: string;
  fileType: "pdf" | "docx" | "txt";
  chunkCount: number;
  originalFileLocation: string;
};

import type { KnowledgeSourceReference } from "./agentContracts";

export type KnowledgeSource = KnowledgeSourceReference;

export type KnowledgeSearchResult = { results: KnowledgeSource[] };

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `Local knowledge service returned HTTP ${response.status}.`);
  return data as T;
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const response = await fetch("/api/knowledge/documents", { cache: "no-store" });
  const result = await parseResponse<{ documents: KnowledgeDocument[] }>(response);
  return result.documents;
}

export async function uploadKnowledgeDocument(file: File): Promise<{ document: KnowledgeDocument; duplicate: boolean }> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch("/api/knowledge/upload", { method: "POST", body: form });
  return parseResponse(response);
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const response = await fetch(`/api/knowledge/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  await parseResponse<{ deleted: boolean }>(response);
}

export async function importSampleKnowledgeDocuments(): Promise<Array<{ filename: string; duplicate: boolean }>> {
  const response = await fetch("/api/knowledge/import-samples", { method: "POST" });
  const result = await parseResponse<{ imported: Array<{ filename: string; duplicate: boolean }> }>(response);
  return result.imported;
}

export async function searchKnowledgeDocuments(query: string): Promise<KnowledgeSearchResult> {
  const response = await fetch("/api/knowledge/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return parseResponse(response);
}

export async function loadKnowledgeSkill(): Promise<string> {
  const response = await fetch("/api/knowledge/skill", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load skills/knowledge.md (HTTP ${response.status}).`);
  const skill = (await response.text()).trim();
  if (!skill) throw new Error("skills/knowledge.md is empty. Add retrieval instructions and try again.");
  return skill;
}
