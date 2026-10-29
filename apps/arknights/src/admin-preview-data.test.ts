import assert from "node:assert/strict";
import test from "node:test";
import { registerMessages } from "@riic/arknights-domain/i18n/localize";
import en from "../messages/en/AK_app_admin_preview_preview_data.json" with { type: "json" };
import zh from "../messages/zh-CN/AK_app_admin_preview_preview_data.json" with { type: "json" };
import { createAdminPreviewRequest } from "./app/admin-preview/preview-data.ts";

registerMessages("en", { AK_app_admin_preview_preview_data: en });
registerMessages("zh-CN", { AK_app_admin_preview_preview_data: zh });

test("sample transport never forwards unknown or privileged requests", async () => {
  const request = createAdminPreviewRequest(false, "en");
  for (const path of ["/api/admin/users", "/api/admin/releases", "/api/endfield/admin/releases", "/api/admin/skill-annotations"]) {
    assert.equal((await request(path)).status, 403);
  }
  assert.equal((await request("https://example.test/private")).status, 404);
  assert.equal((await request("/api/admin/quality", { method: "POST", body: JSON.stringify({ action: "run" }) })).status, 400);
});

test("changelog preview keeps each site's drafts separate", async () => {
  const request = createAdminPreviewRequest(true, "zh-CN");
  const api = "/api/endfield/admin/releases";
  assert.deepEqual((await (await request(api)).json()).data.releases, []);
  const before = (await (await request("/api/admin/releases")).json()).data.releases;
  const draft = { ...before[0].draft, title: { zh: "终末地测试", en: "Endfield test" } };
  const created = (await (await request(api, { method: "POST", body: JSON.stringify(draft) })).json()).data.release;
  assert.deepEqual((await (await request("/api/admin/releases")).json()).data.releases, before);
  assert.equal((await (await request(api)).json()).data.releases[0].draft.title.en, "Endfield test");
  assert.equal((await request(`/api/admin/releases/${created.id}`, { method: "PATCH", body: JSON.stringify({ action: "save", draft }) })).status, 404);
  assert.equal((await request(`${api}/${created.id}`, { method: "PATCH", body: JSON.stringify({ action: "publish" }) })).status, 400, "preview cannot publish to either site");
});

test("sample account changes stay within one preview instance", async () => {
  const request = createAdminPreviewRequest(true, "en");
  const path = "/api/admin/users/preview-user-3";
  assert.equal((await request(path, { method: "PATCH", body: JSON.stringify({ isReviewer: true }) })).status, 200);
  const changed = await (await request("/api/admin/users?q=Kestrel")).json();
  assert.equal(changed.data.users[0].isReviewer, true);
  const fresh = createAdminPreviewRequest(true, "en");
  const reset = await (await fresh("/api/admin/users?q=Kestrel")).json();
  assert.equal(reset.data.users[0].isReviewer, false);
  assert.equal(reset.data.summary.verifiedUsers, 15);
  assert.equal((await request("/api/admin/users/preview-user-0", { method: "PATCH", body: JSON.stringify({ isAdmin: false }) })).status, 400);
});

test("sample queries respect abort signals", async () => {
  const request = createAdminPreviewRequest(true, "zh-CN");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request("/api/admin/users", { signal: controller.signal }), { name: "AbortError" });
});
