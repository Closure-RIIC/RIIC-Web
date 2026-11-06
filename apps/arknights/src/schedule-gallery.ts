import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import layout252 from "@riic/arknights-domain/layouts/252.json" with { type: "json" };
import layout153 from "@riic/arknights-domain/layouts/153.json" with { type: "json" };
import layout333 from "@riic/arknights-domain/layouts/333.json" with { type: "json" };
import layout342 from "@riic/arknights-domain/layouts/342.json" with { type: "json" };
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { createManualScheduleDraft, manualRoomCapacity } from "./manual-schedule.ts";
import { createPosterDocument, posterDataOnly, readPosterFile, type SchedulePosterDocument } from "./schedule-poster-document.ts";
import sampleTeams from "./schedule-poster-sample.json" with { type: "json" };
import { parseGallerySubmission, type GalleryExtras, type GalleryStatus } from "./gallery-publishing.ts";

export const GALLERY_STORAGE_KEY = "riic.schedule-gallery.local.v1";
export const GALLERY_BOOKMARK_KEY = "riic.schedule-gallery.bookmarks.v1";
export type GalleryEntry = Partial<GalleryExtras> & {
  id: string; document: SchedulePosterDocument; source: "sample" | "local" | "community"; addedAt: number;
  status?: GalleryStatus; revision?: number; isOwner?: boolean; authorName?: string; reviewNote?: string;
};

export function galleryOperators(doc: SchedulePosterDocument): string[] {
  return [...new Set(doc.draft.shifts.flatMap(shift => [
    ...Object.values(shift.rooms).flatMap(room => room.operators),
    shift.fiammettaTarget,
  ]).concat(doc.presentation.dormHangerOperators, doc.draft.fiammettaEnabled ? ["菲亚梅塔"] : []).filter((name): name is string => Boolean(name)))];
}

/** Example documents, not community recommendations or simulated popularity. */
export function gallerySamples(): GalleryEntry[] {
  return [
    [layout243, [12, 12]], [layout243, [8, 8, 8]], [layout252, [12, 12]],
    [layout153, [8, 8, 8]], [layout333, [12, 12]], [layout342, [6, 6, 6, 6]],
  ].map(([rawLayout, rawDurations], index) => {
    const layout = rawLayout as BaseBlueprint;
    const durations = rawDurations as number[];
    const draft = createManualScheduleDraft(durations);
    for (const [shiftIndex, shift] of draft.shifts.entries()) {
      for (const room of layout.rooms) {
        const names = (sampleTeams as Record<string, string[][]>)[room.id]?.[shiftIndex % 3] ?? [];
        shift.rooms[room.id] = { operators: names.slice(0, manualRoomCapacity(room)) };
      }
    }
    const document = createPosterDocument(layout, draft);
    return { id: `sample-${index}`, document: posterDataOnly(document), source: "sample", addedAt: 0 };
  });
}

/** Invalid entries are ignored individually so one damaged file cannot hide the library. */
export function readGallery(raw: string | null): GalleryEntry[] {
  if (!raw) return [];
  try {
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 20).flatMap(item => {
      try {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.startsWith("local-")) return [];
        const submission = parseGallerySubmission({ document: readPosterFile(JSON.stringify(item.document)), notes: item.notes ?? "", alternatives: item.alternatives ?? {}, authorBox: item.authorBox });
        return [{ id: item.id, source: "local" as const, addedAt: typeof item.addedAt === "number" ? item.addedAt : 0, ...submission }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function filterGallery(entries: GalleryEntry[], query: string, layout: string, shifts: string): GalleryEntry[] {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (layout === "all" || entry.document.layout.template === layout)
    && (shifts === "all" || String(entry.document.draft.shifts.length) === shifts)
    && (!term || [entry.document.meta.title, entry.authorName ?? "", entry.document.meta.author, entry.notes ?? "", entry.document.meta.instructions, entry.document.layout.template, ...galleryOperators(entry.document)].join(" ").toLocaleLowerCase().includes(term)));
}
