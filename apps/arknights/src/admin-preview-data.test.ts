import assert from "node:assert/strict";
import test from "node:test";
import { createAdminPreviewRequest } from "./app/admin-preview/preview-data.ts";

test("sample transport never forwards unknown or privileged requests", async () => {
  const request = createAdminPreviewRequest(false, true);
  for (const path of ["/api/admin/users", "/api/admin/releases", "/api/admin/skill-annotations"]) {
    assert.equal((await request(path)).status, 403);
  }
  assert.equal((await request("https://example.test/private")).status, 404);
  assert.equal((await request("/api/admin/quality", { method: "POST", body: JSON.stringify({ action: "run" }) })).status, 400);
});

test("sample account changes stay within one preview instance", async () => {
  const request = createAdminPreviewRequest(true, true);
  const path = "/api/admin/users/preview-user-3";
  assert.equal((await request(path, { method: "PATCH", body: JSON.stringify({ isReviewer: true }) })).status, 200);
  const changed = await (await request("/api/admin/users?q=Kestrel")).json();
  assert.equal(changed.data.users[0].isReviewer, true);
  const fresh = createAdminPreviewRequest(true, true);
  const reset = await (await fresh("/api/admin/users?q=Kestrel")).json();
  assert.equal(reset.data.users[0].isReviewer, false);
  assert.equal(reset.data.summary.verifiedUsers, 15);
  assert.equal((await request("/api/admin/users/preview-user-0", { method: "PATCH", body: JSON.stringify({ isAdmin: false }) })).status, 400);
});

test("sample queries respect abort signals", async () => {
  const request = createAdminPreviewRequest(true, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request("/api/admin/users", { signal: controller.signal }), { name: "AbortError" });
});
