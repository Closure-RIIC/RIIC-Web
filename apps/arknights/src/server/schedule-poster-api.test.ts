import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createManualScheduleDraft } from "../manual-schedule.ts";
import { createPosterDocument } from "../schedule-poster-document.ts";
import type { BaseBlueprint } from "../types.ts";
import { createSchedulePoster, getSchedulePoster } from "./schedule-poster-api.ts";

const layoutJson = JSON.parse(readFileSync(new URL("../layouts/252.json", import.meta.url), "utf8")) as BaseBlueprint;

test("Nitro poster API validates and persists a share document outside the release tree", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "riic-poster-api-"));
  const previous = process.env.SCHEDULE_POSTER_STORAGE_DIR;
  process.env.SCHEDULE_POSTER_STORAGE_DIR = storage;
  const document = createPosterDocument(layoutJson, createManualScheduleDraft([12, 12]));
  try {
    const rejected = await createSchedulePoster(new Request("http://localhost/api/schedule-posters", {
      method: "POST",
      headers: { Origin: "https://elsewhere.example" },
      body: JSON.stringify(document),
    }));
    assert.equal(rejected.status, 403);

    const created = await createSchedulePoster(new Request("http://localhost/api/schedule-posters", {
      method: "POST",
      headers: { Origin: "http://localhost" },
      body: JSON.stringify(document),
    }));
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("Cache-Control"), "no-store");
    const { code } = await created.json() as { code: string };
    assert.match(code, /^[a-f0-9]{12}$/);

    const loaded = await getSchedulePoster(new Request(`http://localhost/api/schedule-posters?code=${code}`));
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.get("Cache-Control"), "no-store");
    assert.deepEqual((await loaded.json()).document, document);
  } finally {
    if (previous === undefined) delete process.env.SCHEDULE_POSTER_STORAGE_DIR;
    else process.env.SCHEDULE_POSTER_STORAGE_DIR = previous;
    await rm(storage, { recursive: true, force: true });
  }
});
