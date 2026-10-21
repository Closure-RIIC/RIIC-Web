import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);

const { deleteWebsiteAccountPrivateArtifacts } = await import("./account-deletion.ts");

test("website account deletion removes referenced private feedback and solver runs", async () => {
  const calls: Array<[string, string[]]> = [];
  await deleteWebsiteAccountPrivateArtifacts("user-1", {
    references: async (userId) => {
      assert.equal(userId, "user-1");
      return {
        diagnosticIds: ["11111111-1111-4111-8111-111111111111"],
        feedbackIds: ["feedback-1"],
      };
    },
    deleteFeedback: async (ids) => {
      calls.push(["feedback", ids]);
      return ids.length;
    },
    deleteRuns: async (ids) => {
      calls.push(["runs", ids]);
      return ids.length;
    },
  });

  assert.deepEqual(calls, [
    ["feedback", ["feedback-1"]],
    ["runs", ["11111111-1111-4111-8111-111111111111"]],
  ]);
});

test("website account deletion stops before deleting the account if private cleanup fails", async () => {
  let runsAttempted = false;
  await assert.rejects(
    deleteWebsiteAccountPrivateArtifacts("user-2", {
      references: async () => ({ diagnosticIds: [], feedbackIds: ["feedback-2"] }),
      deleteFeedback: async () => {
        throw new Error("private cleanup failed");
      },
      deleteRuns: async () => {
        runsAttempted = true;
        return 0;
      },
    }),
    /private cleanup failed/,
  );
  assert.equal(runsAttempted, false);
});
