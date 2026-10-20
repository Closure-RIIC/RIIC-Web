import { randomUUID } from "node:crypto";
import { PublicApiError } from "../api-contract.ts";
import { readArtifact, writeArtifact, removeArtifacts } from "./storage.ts";
import { createDraft } from "./service.ts";
import type { previewImports } from "./import.ts";

type Preview = { actorId: string; expiresAt: string; uploadedAt: string; entries: ReturnType<typeof previewImports> };
export async function stageImport(entries: Preview["entries"], actorId: string) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  await writeArtifact(["imports", token, "retention.json"], { expiresAt });
  await writeArtifact(["imports", token, "preview.json"], { actorId, expiresAt, uploadedAt: new Date().toISOString(), entries });
  return { token, entries: entries.map(({ id, name, error }) => ({ id, name, error })) };
}
export async function acceptImport(token: string, excluded: string[], actorId: string) {
  const preview = await readArtifact<Preview>("imports", token, "preview.json").catch(() => null);
  if (!preview || Date.parse(preview.expiresAt) <= Date.now() || preview.actorId !== actorId) throw new PublicApiError("AIC-DATA-8004");
  if (excluded.some((id) => !preview.entries.some((entry) => entry.id === id))) throw new PublicApiError("AIC-REQ-1001");
  const included = preview.entries.filter((entry) => !excluded.includes(entry.id));
  if (!included.length || included.some((entry) => !entry.input || entry.error)) throw new PublicApiError("AIC-REQ-1001", { message: "请明确排除所有无效项。" });
  const drafts = [];
  for (const entry of included) drafts.push(await createDraft(entry.input, actorId, [{ name: entry.name }], new Date(Date.parse(preview.uploadedAt) + 30 * 24 * 60 * 60_000)));
  await removeArtifacts("imports", token);
  return drafts.map((draft) => ({ id: draft.id }));
}
