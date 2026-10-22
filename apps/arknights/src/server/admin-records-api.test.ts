import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin record responses are private and non-cacheable on success and failure", async () => {
  const source = await readFile(new URL("./admin-records-api.ts", import.meta.url), "utf8");

  assert.equal(source.includes('response.headers.set("Cache-Control", "private, no-store, max-age=0")'), true);
  assert.equal(source.includes("return noStore(successResponse"), true);
  assert.equal(source.includes("return noStore(failureResponse"), true);
  assert.equal(source.includes("noStore(failureResponse(new PublicApiError"), true);
});

test("admin issue details and deletion retain their privacy boundaries", async () => {
  const source = await readFile(new URL("./admin-records-api.ts", import.meta.url), "utf8");
  const feedbackDetail = source.indexOf("await readFeedbackReproduction(item.id, item.diagnosticId");
  const failedRunGuard = source.indexOf('item.status !== "failed"');
  const readReproduction = source.indexOf("await readPlanReproduction(item.diagnosticId", failedRunGuard);
  const deleteArtifacts = source.indexOf("await deleteFeedbackArtifacts(ids)");
  const deleteRows = source.indexOf("await deleteFeedbackRecords(ids)");

  assert.equal(feedbackDetail > 0, true);
  assert.equal(failedRunGuard > 0, true);
  assert.equal(readReproduction > failedRunGuard, true);
  assert.equal(deleteArtifacts > 0, true);
  assert.equal(deleteRows > deleteArtifacts, true);
  assert.equal(source.includes('feedbackFacility(params.get("facility"))'), true);
  for (const field of ["artifactKey", "artifactStatus", "executionSource", "expiresAt"]) {
    assert.equal(source.includes(field), true);
  }
});

test("admin issue UI explains every reproduction availability state", async () => {
  const source = await readFile(new URL("../app/admin/issues/issues-client.tsx", import.meta.url), "utf8");
  const namespace = "app_admin_issues_issues_client_labels";
  assert.equal(source.includes(namespace), true);
  const catalogs = await Promise.all(["zh", "en"].map(async (locale) =>
    JSON.parse(await readFile(new URL(`../../messages/records/${locale}.json`, import.meta.url), "utf8")),
  ));
  for (const reason of [
    "expired",
    "cache_hit",
    "finalizing",
    "finalization_failed",
    "not_recorded",
    "missing",
    "invalid",
    "incomplete",
  ]) {
    for (const catalog of catalogs) {
      assert.equal(typeof catalog[namespace][reason], "string");
      assert.ok(catalog[namespace][reason].trim().length > 0);
    }
  }
});
