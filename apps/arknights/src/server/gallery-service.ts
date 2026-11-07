import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { GalleryError, parseGallerySubmission, type GalleryActor, type GalleryRecord, type GalleryPublicRecord, type GalleryStatus } from "../gallery-publishing.ts";

export function galleryVisibleRecord(record: GalleryRecord, actor: GalleryActor | null): GalleryPublicRecord | null {
  const isOwner = actor?.id === record.ownerId;
  if (record.status !== "published" && !isOwner && actor?.role !== "admin") return null;
  return {
    id: record.id, document: record.document, notes: record.notes, alternatives: record.alternatives,
    ...(record.authorBox ? { authorBox: record.authorBox } : {}), authorName: record.authorName,
    status: record.status, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
    isOwner, ...((isOwner || actor?.role === "admin") ? { reviewNote: record.reviewNote } : {}),
  };
}

/** A local, durable gallery store, separate from private poster snapshots. */
export function createGalleryService(directory: string) {
  const filename = path.join(directory, "gallery.json");
  async function read(): Promise<GalleryRecord[]> {
    try { return JSON.parse(await readFile(filename, "utf8")) as GalleryRecord[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async function mutate<T>(operation: (records: GalleryRecord[]) => T): Promise<T> {
    await mkdir(directory, { recursive: true });
    const lockPath = path.join(directory, ".write.lock");
    let lock;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { lock = await open(lockPath, "wx", 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!lock) throw new GalleryError("busy");
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const records = await read();
      const result = operation(records);
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(records)); await file.sync(); } finally { await file.close(); }
      await rename(temp, filename);
      return result;
    } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
  }
  return {
    async list(actor: GalleryActor | null) {
      return (await read()).map(record => galleryVisibleRecord(record, actor)).filter((record): record is GalleryPublicRecord => record !== null).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async submit(actor: GalleryActor | null, input: unknown, options: { id?: string; revision?: number; publish?: boolean } = {}) {
      if (!actor) throw new GalleryError("forbidden");
      if (options.publish && actor.role !== "admin") throw new GalleryError("forbidden");
      const submission = parseGallerySubmission(input);
      return mutate(records => {
        const previous = options.id ? records.find(record => record.id === options.id) : undefined;
        if (options.id && !previous) throw new GalleryError("notFound");
        if (previous && previous.ownerId !== actor.id) throw new GalleryError("forbidden");
        if (previous && previous.revision !== options.revision) throw new GalleryError("conflict");
        if (!previous && (records.length >= 1000 || records.filter(record => record.ownerId === actor.id).length >= 50)) throw new GalleryError("full");
        const now = Date.now();
        const record: GalleryRecord = {
          ...submission, id: previous?.id ?? randomUUID(), ownerId: actor.id, authorName: actor.name,
          status: options.publish ? "published" : "pending", revision: (previous?.revision ?? 0) + 1,
          createdAt: previous?.createdAt ?? now, updatedAt: now, reviewNote: "",
          ...(options.publish ? { reviewedBy: actor.id } : {}),
        };
        if (previous) records[records.indexOf(previous)] = record; else records.push(record);
        return galleryVisibleRecord(record, actor)!;
      });
    },
    async review(actor: GalleryActor | null, id: string, revision: number, decision: GalleryStatus, note: string) {
      if (actor?.role !== "admin") throw new GalleryError("forbidden");
      if (!["published", "rejected", "hidden"].includes(decision) || typeof note !== "string" || note.length > 2000) throw new GalleryError("invalid");
      if (decision === "rejected" && !note.trim()) throw new GalleryError("invalid");
      return mutate(records => {
        const record = records.find(item => item.id === id);
        if (!record) throw new GalleryError("notFound");
        if (record.revision !== revision) throw new GalleryError("conflict");
        if (decision === "hidden" && record.status !== "published") throw new GalleryError("invalid");
        record.status = decision; record.reviewNote = note.trim(); record.reviewedBy = actor.id;
        record.updatedAt = Date.now(); record.revision++;
        return galleryVisibleRecord(record, actor)!;
      });
    },
  };
}
