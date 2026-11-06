import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGalleryService } from "./gallery-service.ts";
import { gallerySamples } from "../schedule-gallery.ts";
import type { GalleryActor } from "../gallery-publishing.ts";

const author: GalleryActor = { id: "author", name: "Author", role: "user" };
const other: GalleryActor = { id: "other", name: "Other", role: "user" };
const admin: GalleryActor = { id: "admin", name: "Admin", role: "admin" };
test("submission, private review, publication, edits and stale review permissions", async () => {
  const prefix = path.join(tmpdir(), "riic-gallery-test-");
  const directory = await mkdtemp(prefix);
  assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
  try {
    const service = createGalleryService(directory);
    const submission = { document: gallerySamples()[0]!.document, notes: "Author notes", alternatives: {} };
    await assert.rejects(service.submit(null, submission), { code: "forbidden" });
    await assert.rejects(service.submit(author, submission, { publish: true }), { code: "forbidden" });
    const pending = await service.submit(author, submission);
    assert.equal(pending.status, "pending");
    assert.equal((await service.list(null)).length, 0);
    assert.equal((await service.list(other)).length, 0);
    assert.equal((await service.list(author)).length, 1);
    await assert.rejects(service.review(author, pending.id, 1, "published", ""), { code: "forbidden" });
    await assert.rejects(service.submit(other, submission, { id: pending.id, revision: 1 }), { code: "forbidden" });
    await assert.rejects(service.review(admin, pending.id, 1, "rejected", ""), { code: "invalid" });
    const published = await service.review(admin, pending.id, 1, "published", "private review note");
    const publicView = (await service.list(null))[0]!;
    assert.equal(publicView.notes, submission.notes);
    assert.ok(!("ownerId" in publicView)); assert.ok(!("reviewedBy" in publicView)); assert.ok(!("reviewNote" in publicView));
    assert.equal((await createGalleryService(directory).list(null)).length, 1);
    const edited = await service.submit(author, { ...submission, notes: "updated" }, { id: pending.id, revision: published.revision });
    assert.equal(edited.status, "pending");
    assert.equal((await service.list(null)).length, 0);
    await assert.rejects(service.review(admin, pending.id, published.revision, "published", ""), { code: "conflict" });
    const approved = await service.review(admin, pending.id, edited.revision, "published", "");
    const hidden = await service.review(admin, pending.id, approved.revision, "hidden", "withdrawn");
    assert.equal(hidden.status, "hidden"); assert.equal((await service.list(null)).length, 0);
    const direct = await service.submit(admin, submission, { publish: true });
    assert.equal(direct.status, "published");
    const concurrent = await Promise.allSettled([
      service.review(admin, direct.id, direct.revision, "hidden", "one"),
      service.review(admin, direct.id, direct.revision, "hidden", "two"),
    ]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
