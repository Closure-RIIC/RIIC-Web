import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Endfield access uses current database roles and rejects revoked, banned and missing accounts", async t => {
  const environment = { ...process.env };
  t.after(() => { process.env = environment; });
  process.env.BETTER_AUTH_ADMIN_USER_IDS = "bootstrap-admin";
  let session: { user: { id: string; role: string } } | null = null;
  let account: { role: string; banned: boolean } | undefined;
  let unavailable = false;
  await t.mock.module(new URL("./index.ts", import.meta.url), { namedExports: { websiteSession: async () => {
    if (unavailable) throw new Error("offline");
    return session;
  } } });
  await t.mock.module(new URL("../db/index.ts", import.meta.url), { namedExports: { getDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => account ? [account] : [] }) }) }),
  }) } });
  await t.mock.module(new URL("../db/schema.ts", import.meta.url), { namedExports: { user: { id: "id", role: "role", banned: "banned" } } });
  const { endfieldAccessResponse } = await import("./endfield-access.ts");
  const request = new Request("https://riic.autos/api/platform/endfield-access");
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  session = { user: { id: "account", role: "admin" } };
  for (const role of ["user", "reviewer"]) {
    account = { role, banned: false };
    assert.equal((await endfieldAccessResponse(request)).status, 403);
  }
  account = { role: "admin", banned: false };
  session.user.role = "user";
  const granted = await endfieldAccessResponse(request);
  assert.equal(granted.status, 204);
  assert.match(granted.headers.get("cache-control")!, /no-store/);
  assert.equal(granted.headers.get("vary"), "Cookie");
  account.banned = true;
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  account = undefined;
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  session.user.id = "bootstrap-admin";
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  account = { role: "user", banned: false };
  assert.equal((await endfieldAccessResponse(request)).status, 204);
  account.banned = true;
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  unavailable = true;
  assert.equal((await endfieldAccessResponse(request)).status, 403);
  assert.equal((await endfieldAccessResponse(new Request(request, { method: "POST" }))).status, 405);
});
