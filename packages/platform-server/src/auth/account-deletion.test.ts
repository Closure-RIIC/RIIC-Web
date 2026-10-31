import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

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

test("account artifact cleanup supports service HOME storage and preserves directory boundaries", async (context) => {
  const fixtureRoot = await realpath(await mkdtemp(path.join(tmpdir(), "riic-account-cleanup-")));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const storageRoot = path.join(fixtureRoot, "service-home");
  const feedbackRoot = path.join(storageRoot, "feedback");
  const runsRoot = path.join(storageRoot, "cli-runs");
  const outsideRoot = path.join(fixtureRoot, "outside");
  const diagnosticId = "11111111-1111-4111-8111-111111111111";
  const feedbackDirectory = path.join(feedbackRoot, "account-feedback");
  const runDirectory = path.join(runsRoot, "account_" + diagnosticId);
  await Promise.all([feedbackRoot, runsRoot, outsideRoot].map((root) => mkdir(root, { recursive: true })));
  await Promise.all([
    writeFile(path.join(storageRoot, "service-config"), "keep service files"),
    writeFile(path.join(outsideRoot, "private-file"), "keep outside files"),
    mkdir(path.join(feedbackRoot, "unrelated-feedback")),
    mkdir(path.join(runsRoot, "unrelated-run")),
  ]);

  const environment = {
    BETA_STORAGE_DIR: storageRoot,
    BETA_FEEDBACK_DIR: feedbackRoot,
    BETA_CLI_RUN_DIR: runsRoot,
    BETA_BUSINESS_DB_ENABLED: "0",
    HOME: storageRoot,
    USERPROFILE: storageRoot,
  };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  context.after(() => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  assert.equal(homedir(), storageRoot);

  const { deleteFeedbackArtifacts, deletePlanRunArtifacts } = await import("../infra.ts");
  const cleanup = () => deleteWebsiteAccountPrivateArtifacts("fixture-user", {
    references: async () => ({ diagnosticIds: [diagnosticId], feedbackIds: ["fixture-feedback"] }),
    deleteFeedback: deleteFeedbackArtifacts,
    deleteRuns: deletePlanRunArtifacts,
  });
  const createArtifacts = async () => {
    await Promise.all([feedbackDirectory, runDirectory].map((directory) => mkdir(directory, { recursive: true })));
    await writeFile(path.join(feedbackDirectory, "meta.json"), JSON.stringify({ feedbackId: "fixture-feedback" }));
    await writeFile(path.join(runDirectory, "result.json"), JSON.stringify({ runId: diagnosticId }));
  };

  await context.test("removes only referenced artifacts when storage equals HOME", async () => {
    await createArtifacts();
    await cleanup();
    await assert.rejects(stat(feedbackDirectory), { code: "ENOENT" });
    await assert.rejects(stat(runDirectory), { code: "ENOENT" });
    assert.equal(await readFile(path.join(storageRoot, "service-config"), "utf8"), "keep service files");
    await assert.doesNotReject(stat(path.join(feedbackRoot, "unrelated-feedback")));
    await assert.doesNotReject(stat(path.join(runsRoot, "unrelated-run")));
    await cleanup();
  });

  await context.test("refuses storage above HOME and leaves account artifacts intact", async () => {
    await createArtifacts();
    process.env.HOME = process.env.USERPROFILE = path.join(storageRoot, "nested-home");
    try {
      await assert.rejects(cleanup(), /整体存储目录配置过于宽泛/);
      await assert.doesNotReject(stat(feedbackDirectory));
      await assert.doesNotReject(stat(runDirectory));
    } finally {
      Object.assign(process.env, environment);
    }
  });

  for (const [name, destination] of [["storage itself", storageRoot], ["outside storage", outsideRoot]]) {
    await context.test("refuses a feedback root linked to " + name, async () => {
      const savedRoot = path.join(storageRoot, "saved-feedback");
      await rename(feedbackRoot, savedRoot);
      try {
        await symlink(destination, feedbackRoot, process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(cleanup(), /真实路径越过了整体存储边界/);
        await assert.doesNotReject(stat(path.join(savedRoot, "account-feedback")));
        await assert.doesNotReject(stat(runDirectory));
        assert.equal(await readFile(path.join(outsideRoot, "private-file"), "utf8"), "keep outside files");
      } finally {
        await unlink(feedbackRoot).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        await rename(savedRoot, feedbackRoot);
      }
    });
  }
});
