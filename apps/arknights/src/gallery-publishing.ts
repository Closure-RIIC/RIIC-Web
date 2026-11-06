import { z } from "zod";
import { operatorFor } from "./operator-catalog.ts";
import { posterDataOnly, type SchedulePosterDocument } from "./schedule-poster-document.ts";
import { galleryOperators } from "./schedule-gallery.ts";
import type { OperBoxEntry } from "@riic/arknights-domain/types";
import { manualLevelFor, maxEliteForRarity } from "@riic/arknights-domain/manual-operbox";

export type GalleryStatus = "pending" | "published" | "rejected" | "hidden";
export type GalleryActor = { id: string; name: string; role: "user" | "admin" };
export type GalleryExtras = { notes: string; alternatives: Record<string, string[]>; authorBox?: OperBoxEntry[] };
export type GallerySubmission = GalleryExtras & { document: SchedulePosterDocument };
export type GalleryRecord = GallerySubmission & {
  id: string; ownerId: string; authorName: string; status: GalleryStatus; revision: number;
  createdAt: number; updatedAt: number; reviewNote: string; reviewedBy?: string;
};
export type GalleryPublicRecord = Omit<GalleryRecord, "ownerId" | "reviewedBy" | "reviewNote"> & { isOwner: boolean; reviewNote?: string };
export class GalleryError extends Error {
  code: "invalid" | "forbidden" | "conflict" | "notFound" | "full" | "busy";
  constructor(code: GalleryError["code"]) { super(code); this.code = code; }
}
const boxSchema = z.array(z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(80), elite: z.number().int().min(0).max(2),
  level: z.number().int().min(1).max(90), own: z.boolean(), potential: z.number().int().min(1).max(6), rarity: z.number().int().min(1).max(6),
})).max(1000);
const extrasSchema = z.object({
  notes: z.string().max(2000).default(""), alternatives: z.record(z.string().max(80), z.array(z.string().max(80)).max(5)).default({}),
  authorBox: boxSchema.optional(),
});
export const operatorKey = (operator: { name: string; id?: string }) => operatorFor(operator.name, operator.id)?.id ?? operator.name;

export function parseGallerySubmission(value: unknown): GallerySubmission {
  try {
    if (!value || typeof value !== "object" || !("document" in value)) throw new Error();
    const document = posterDataOnly(value.document as SchedulePosterDocument);
    if (!document.meta.title.trim()) throw new Error();
    const extras = extrasSchema.parse(value);
    const included = new Set(galleryOperators(document));
    if (Object.keys(extras.alternatives).length > 200) throw new Error();
    for (const [primary, backups] of Object.entries(extras.alternatives)) {
      if (!included.has(primary) || (primary === "菲亚梅塔" && document.draft.fiammettaEnabled)) throw new Error();
      const identities = backups.map(name => {
        const operator = operatorFor(name);
        if (!operator || operator.name !== name || operator.id === operatorKey({ name: primary })) throw new Error();
        return operator.id;
      });
      if (new Set(identities).size !== identities.length) throw new Error();
    }
    if (extras.authorBox) {
      const ids = new Set<string>();
      extras.authorBox = extras.authorBox.filter(operator => operator.own).map(operator => {
        const canonical = operatorFor(operator.name, operator.id);
        if (!canonical || operatorFor(operator.name)?.id !== canonical.id || ids.has(canonical.id)) throw new Error();
        if (operator.rarity !== canonical.rarity || operator.elite > maxEliteForRarity(canonical.rarity) || operator.level > manualLevelFor(canonical.rarity, operator.elite)) throw new Error();
        ids.add(canonical.id);
        return { ...operator, id: canonical.id, name: canonical.name };
      });
    }
    return { document, ...extras };
  } catch { throw new GalleryError("invalid"); }
}

export function compareGalleryBox(doc: SchedulePosterDocument, viewer: readonly OperBoxEntry[], authorBox?: readonly OperBoxEntry[]) {
  const mine = new Map(viewer.filter(operator => operator.own).map(operator => [operatorKey(operator), operator]));
  const author = new Map((authorBox ?? doc.operators).filter(operator => operator.own).map(operator => [operatorKey(operator), operator]));
  const required = galleryOperators(doc);
  const missing = required.filter(name => !mine.has(operatorKey({ name })));
  const unknownTraining = required.filter(name => mine.has(operatorKey({ name })) && !doc.operators.some(operator => operatorKey(operator) === operatorKey({ name })) && !author.has(operatorKey({ name })));
  const lowerTraining = required.flatMap(name => {
    const key = operatorKey({ name });
    const actual = mine.get(key);
    const expected = doc.operators.find(operator => operatorKey(operator) === key) ?? author.get(key);
    return actual && expected && (actual.elite < expected.elite || (actual.elite === expected.elite && actual.level < expected.level))
      ? [{ name, actual, expected }] : [];
  });
  return {
    required: required.length, missing, lowerTraining, unknownTraining,
    common: [...author.keys()].filter(id => mine.has(id)).length,
    authorOnly: [...author].filter(([id]) => !mine.has(id)).map(([, operator]) => operator.name),
    viewerOnly: [...mine].filter(([id]) => !author.has(id)).map(([, operator]) => operator.name),
  };
}

/** Only explicitly authored replacements may be applied; validate the resulting schedule. */
export function applyGalleryAlternatives(submission: GallerySubmission, choices: Record<string, string>, viewer: readonly OperBoxEntry[]) {
  const source = parseGallerySubmission(submission);
  const replace = (name: string | null) => name ? choices[name] || name : null;
  for (const [primary, backup] of Object.entries(choices)) {
    if (backup && !source.alternatives[primary]?.includes(backup)) throw new GalleryError("invalid");
  }
  const document = structuredClone(source.document);
  for (const shift of document.draft.shifts) {
    const assigned = new Set<string>();
    for (const room of Object.values(shift.rooms)) {
      room.operators = room.operators.map(replace);
      for (const name of room.operators) if (name) {
        const key = operatorKey({ name });
        if (assigned.has(key)) throw new GalleryError("invalid");
        assigned.add(key);
      }
    }
    shift.fiammettaTarget = replace(shift.fiammettaTarget);
  }
  document.presentation.dormHangerOperators = document.presentation.dormHangerOperators.map(replace);
  for (const backup of Object.values(choices).filter(Boolean)) {
    const training = viewer.find(operator => operator.own && operatorKey(operator) === operatorKey({ name: backup }))
      ?? source.authorBox?.find(operator => operatorKey(operator) === operatorKey({ name: backup }));
    if (training) {
      document.operators = document.operators.filter(operator => operatorKey(operator) !== operatorKey(training));
      document.operators.push({ ...training, name: backup });
    }
  }
  return posterDataOnly(document);
}
