import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import process from "node:process";
import { URL } from "node:url";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("./db/index.ts");
const { createWish, listPublicWishes, updateWish } = await import("./wishes.ts");
const { getDonationSetting, saveDonationSetting } = await import("./site-settings.ts");

test("wish moderation, public privacy, concurrent quota and account cleanup", async () => {
  const pool = getDatabasePool();
  const id = "wish-test-" + randomUUID();
  try {
    await pool.query('INSERT INTO public."user" (id,name,email) VALUES ($1,$1,$2)', [id, id + "@example.test"]);
    const created = await createWish({ userId: id, title: id, content: "private pending content", imageUrls: [] });
    assert.ok(!(await listPublicWishes()).some(item => item.id === created.id));
    await updateWish(created.id, { status: "approved", adminNote: "internal moderation note" });
    const visible = (await listPublicWishes()).find(item => item.id === created.id);
    assert.ok(visible);
    assert.equal("userId" in visible, false);
    assert.equal("adminNote" in visible, false);
    await updateWish(created.id, { status: "hidden" });
    assert.ok(!(await listPublicWishes()).some(item => item.id === created.id));
    const races = await Promise.allSettled(Array.from({ length: 8 }, () => createWish({ userId: id, title: id, content: "quota", imageUrls: [] })));
    assert.equal(races.filter(result => result.status === "fulfilled").length, 4);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.wish WHERE user_id=$1", [id])).rows[0].n, 5);
    assert.deepEqual(await saveDonationSetting({ enabled: false, imageUrl: null }), { enabled: false, imageUrl: null });
    assert.deepEqual(await getDonationSetting(), { enabled: false, imageUrl: null });
    await pool.query('DELETE FROM public."user" WHERE id=$1', [id]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.wish WHERE user_id=$1", [id])).rows[0].n, 0);
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=$1', [id]);
    await pool.query("DELETE FROM app.site_setting WHERE key='wishes.donation'");
    await pool.end();
  }
});
