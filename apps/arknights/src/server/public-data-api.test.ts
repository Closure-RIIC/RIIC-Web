import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("public release handlers cache only published DTOs, invalidate mutations and never cache failures/admin", async (context) => {
  const marker = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
    },
  });
  context.after(() => marker.deregister());
  let environment = "local";
  await context.mock.module(new URL("../../../../packages/arknights-domain/src/deployment.ts", import.meta.url), {
    namedExports: { appDeploymentEnvironment: () => environment },
  });
  await context.mock.module(new URL("../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), {
    namedExports: { requireWebsiteAdmin: async () => ({ session: { user: { id: "admin" } } }) },
  });
  let rateLimited = false;
  let limits = 0;
  await context.mock.module(new URL("../../../../packages/platform-server/src/api-contract.ts", import.meta.url), {
    namedExports: {
      assertSameOrigin: () => {}, createRequestId: () => "request", requestClientIp: () => "test",
      enforceRateLimit: () => { limits++; if (rateLimited) throw new Error("rate limited"); },
      failureResponse: () => Response.json({ success: false }, { status: 429 }),
      successResponse: (data: unknown) => Response.json({ success: true, data }),
      PublicApiError: class extends Error {}, readJsonBody: (request: Request) => request.json(),
    },
  });
  let loads = 0;
  let adminLoads = 0;
  let version = "1.0.0";
  await context.mock.module(new URL("../../../../packages/platform-server/src/releases/service.ts", import.meta.url), {
    namedExports: {
      createRelease: async () => ({}),
      listAdminReleases: async () => { adminLoads++; return [{ draft: "private" }]; },
      listPublishedReleases: async (env: string, app: string) => { loads++; return [{ version, notify: true, title: `${app}:${env}` }]; },
      mutateRelease: async () => { version = "1.0.1"; return {}; },
      ReleaseConflictError: class extends Error {}, ReleaseNotFoundError: class extends Error {},
    },
  });
  const { handlePublicReleases, handleAdminReleases, handleAdminReleaseMutation } = await import("./release-notes-api.ts");
  const request = () => new Request("https://example.test/api/releases");
  const [first, second] = await Promise.all([handlePublicReleases(request()), handlePublicReleases(request())]);
  assert.equal(loads, 1);
  assert.equal(first.headers.get("cache-control"), "public, max-age=15, must-revalidate");
  assert.deepEqual(await first.json(), await second.json());
  await handlePublicReleases(new Request("https://example.test/api/releases?mode=announcement"));
  assert.equal(loads, 1, "announcement and list share the same published DTO cache");
  environment = "production";
  await handlePublicReleases(request());
  assert.equal(loads, 2);
  const mutation = await handleAdminReleaseMutation(new Request("https://example.test/api/admin/releases/id", {
    method: "PATCH", body: JSON.stringify({ action: "publish", revision: 1 }),
  }), "id");
  assert.match(mutation.headers.get("cache-control")!, /private, no-store/);
  const fresh = await (await handlePublicReleases(request())).json();
  assert.equal(fresh.data.releases[0].version, "1.0.1");
  assert.equal(loads, 3);
  const admin = await handleAdminReleases(request());
  await handleAdminReleases(request());
  assert.match(admin.headers.get("cache-control")!, /private, no-store/);
  assert.equal(adminLoads, 2);
  rateLimited = true;
  const denied = await handlePublicReleases(request());
  assert.equal(denied.status, 429);
  assert.match(denied.headers.get("cache-control")!, /no-store/);
  assert.equal(loads, 3, "rate limits run even when a public value is cached");
  assert.equal(limits, 9);
  rateLimited = false;
  const endfield = await (await handlePublicReleases(request(), "endfield")).json();
  assert.equal(endfield.data.releases[0].title, "endfield:production");
  assert.equal(loads, 4, "applications have independent public caches");
  await handleAdminReleaseMutation(new Request("https://example.test/api/endfield/admin/releases/id", {
    method: "PATCH", headers: { origin: "https://example.test" }, body: JSON.stringify({ action: "publish", revision: 1 }),
  }), "id", "endfield");
  assert.equal((await (await handlePublicReleases(request())).json()).data.releases[0].title, "arknights:production");
  assert.equal(loads, 4, "Endfield mutations preserve the Arknights cache");
  await handlePublicReleases(request(), "endfield");
  assert.equal(loads, 5, "Endfield mutations invalidate its own cache");
});

test("skill annotation handlers cache sanitized data and invalidate create, update and delete", async (context) => {
  const marker = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
    },
  });
  context.after(() => marker.deregister());
  await context.mock.module(new URL("../../../../packages/arknights-domain/src/deployment.ts", import.meta.url), {
    namedExports: { appDeploymentEnvironment: () => "local" },
  });
  await context.mock.module(new URL("../operatorPortraits.ts", import.meta.url), {
    namedExports: { OPERATOR_CATALOG: [{ id: "operator", buildingSkills: [{ id: "skill" }] }] },
  });
  await context.mock.module(new URL("../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), {
    namedExports: { requireWebsiteAdmin: async () => ({ session: { user: { id: "admin" } } }) },
  });
  let limited = false;
  await context.mock.module(new URL("../../../../packages/platform-server/src/api-contract.ts", import.meta.url), {
    namedExports: {
      assertEmptyBody: async () => {}, assertSameOrigin: () => {}, createRequestId: () => "request",
      requestClientIp: () => "test", enforceRateLimit: () => { if (limited) throw new Error("limit"); },
      failureResponse: () => Response.json({ success: false }, { status: 429 }),
      successResponse: (data: unknown, _id: string, status = 200) => Response.json({ success: true, data }, { status }),
      PublicApiError: class extends Error {}, readJsonBody: (request: Request) => request.json(),
    },
  });
  await context.mock.module(new URL("../../../../packages/platform-server/src/db/schema.ts", import.meta.url), {
    namedExports: { skillAnnotation: { id: "id", operatorId: "operatorId", skillId: "skillId", updatedAt: "updatedAt" } },
  });
  let reads = 0;
  let record = {
    id: "annotation", operatorId: "operator", skillId: "skill", note: "initial",
    createdByUserId: "private-admin", updatedByUserId: "private-admin",
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  let deleted = false;
  const db = {
    select: () => ({ from: () => ({ orderBy: async () => { reads++; return deleted ? [] : [{ ...record }]; } }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => { record.note = "created"; return [{ ...record }]; } }) }) }),
    update: () => ({ set: (fields: Partial<typeof record>) => ({ where: () => ({ returning: async () => { record = { ...record, ...fields }; return [{ ...record }]; } }) }) }),
    delete: () => ({ where: () => ({ returning: async () => { deleted = true; return [{ id: record.id }]; } }) }),
  };
  await context.mock.module(new URL("../../../../packages/platform-server/src/db/index.ts", import.meta.url), { namedExports: { getDatabase: () => db } });
  const api = await import("./skill-annotations-api.ts");
  const request = (method = "GET", body?: unknown) => new Request("https://example.test/api/skill-annotations", {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const [first, second] = await Promise.all([api.handleListSkillAnnotations(request()), api.handleListSkillAnnotations(request())]);
  assert.equal(reads, 1);
  assert.equal(first.headers.get("cache-control"), "public, max-age=15, must-revalidate");
  const body = await first.json();
  assert.deepEqual(body, await second.json());
  assert.deepEqual(Object.keys(body.data.annotations[0]).sort(), ["id", "note", "operatorId", "skillId", "updatedAt"]);
  const created = await api.handleCreateAdminSkillAnnotation(request("POST", { operatorId: "operator", skillId: "skill", note: "created" }));
  assert.equal(created.status, 201);
  assert.match(created.headers.get("cache-control")!, /private, no-store/);
  assert.equal((await (await api.handleListSkillAnnotations(request())).json()).data.annotations[0].note, "created");
  await api.handleUpdateAdminSkillAnnotation(request("PATCH", { note: "updated" }), "annotation");
  assert.equal((await (await api.handleListSkillAnnotations(request())).json()).data.annotations[0].note, "updated");
  await api.handleDeleteAdminSkillAnnotation(request("DELETE"), "annotation");
  assert.deepEqual((await (await api.handleListSkillAnnotations(request())).json()).data.annotations, []);
  assert.equal(reads, 4);
  const admin = await api.handleListAdminSkillAnnotations(request());
  await api.handleListAdminSkillAnnotations(request());
  assert.equal(reads, 6);
  assert.match(admin.headers.get("cache-control")!, /private, no-store/);
  limited = true;
  const denied = await api.handleListSkillAnnotations(request());
  assert.equal(denied.status, 429);
  assert.match(denied.headers.get("cache-control")!, /no-store/);
});
