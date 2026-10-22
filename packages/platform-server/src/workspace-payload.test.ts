import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkspaceRevision,
  validateSavedPlanCalculationContext,
  validateWorkspacePutRequest,
  workspaceMatchesSavedPlanContext,
} from "./workspace-payload.ts";

test("workspace writes reject stale, future and missing versions before replacing an existing workspace", () => {
  const first = validateWorkspacePutRequest({ state: state("sample"), operbox: null, result: null });
  assert.equal(first.baseRevision, 0);
  assert.doesNotThrow(() => assertWorkspaceRevision(first.baseRevision, 0));
  for (const baseRevision of [0, 1, 3]) {
    assert.throws(() => assertWorkspaceRevision(baseRevision, 2), { code: "AIC-DATA-8005", status: 409 });
  }
  assert.doesNotThrow(() => assertWorkspaceRevision(2, 2));
  for (const baseRevision of [-1, 0.5, "2", true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateWorkspacePutRequest({ state: state("sample"), baseRevision }), { code: "AIC-DATA-8003" });
  }
  const restored = validateWorkspacePutRequest({ restoreRevisionId: "b267a2b4-0955-4a27-8539-22b08e3e2419", baseRevision: 2 });
  assert.equal(restored.baseRevision, 2);
});

function state(boxSource: "maa" | "sample" | "skland" = "maa") {
  return {
    presetLabel: "243",
    layout: {
      template: "243",
      drone_cap: 235,
      scenario: { sui_facility_count: 2, injected: { token: "secret" } },
      rooms: [
        { id: "control", kind: "control_center", level: 5, command: "private" },
        { id: "power", kind: "power_plant", level: 3 },
      ],
      stdout: "private",
    },
    sourceName: boxSource === "skland" ? "第三方昵称" : "box.json",
    boxSource,
    layoutDirty: false,
    layoutSource: boxSource === "skland" ? "skland" : "local",
    localLayoutBackup: null,
    rotationProfile: "abc_12_6_6",
    fiammettaEnabled: false,
    activeShift: 0,
    credentials: "private",
  };
}

test("workspace payload reconstructs an exact state and layout whitelist", () => {
  const result = validateWorkspacePutRequest({
    state: state("maa"),
    operbox: [{ id: "char_1", name: "测试干员", elite: 2, level: 80, own: true, potential: 1, rarity: 6, token: "private" }],
    result: null,
    unknown: { box: "private" },
  });
  assert.ok("state" in result);
  assert.deepEqual(Object.keys(result.state).sort(), [
    "activeShift",
    "boxSource",
    "fiammettaEnabled",
    "layout",
    "layoutDirty",
    "layoutSource",
    "localLayoutBackup",
    "presetLabel",
    "rotationProfile",
    "sourceName",
  ]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Skland-derived identity, Box and plan data cannot enter a cloud payload", () => {
  const sanitized = validateWorkspacePutRequest({ state: state("skland"), operbox: null, result: { token: "private" } });
  assert.ok("state" in sanitized);
  assert.equal(sanitized.state.sourceName, null);
  assert.equal(sanitized.operbox, null);
  assert.equal(sanitized.result, null);
  assert.throws(() => validateWorkspacePutRequest({
    state: state("skland"),
    operbox: [{ id: "char_1" }],
    result: null,
  }));
});

test("saved plans retain only the calculation context needed to render the original result", () => {
  const workspace = validateWorkspacePutRequest({
    state: state("maa"),
    operbox: [{ id: "char_1", name: "测试干员", elite: 2, level: 80, own: true, potential: 1, rarity: 6 }],
    result: null,
  });
  assert.ok("state" in workspace);
  const context = {
    presetLabel: workspace.state.presetLabel,
    layout: workspace.state.layout,
    rotationProfile: workspace.state.rotationProfile,
    fiammettaEnabled: workspace.state.fiammettaEnabled,
  };
  assert.deepEqual(Object.keys(context).sort(), ["fiammettaEnabled", "layout", "presetLabel", "rotationProfile"]);
  assert.equal(JSON.stringify(context).includes("box.json"), false);

  const restored = validateSavedPlanCalculationContext({ ...context, token: "private" });
  assert.deepEqual(restored, context);
  assert.equal(workspaceMatchesSavedPlanContext(workspace.state, context, workspace.operbox), true);
  assert.equal(workspaceMatchesSavedPlanContext(
    { ...workspace.state, layout: { ...workspace.state.layout, template: "333" } },
    context,
    workspace.operbox,
  ), false);
  assert.equal(validateSavedPlanCalculationContext({
    ...context,
    layout: { ...context.layout, scenario: { base_workforce: ["private-operator"] } },
  })?.layout.scenario.base_workforce, undefined);
  assert.equal(validateSavedPlanCalculationContext({ ...context, rotationProfile: "invalid" }), null);
});

test("workspace payload preserves optional training-room shifts without adding them to MAA rooms", () => {
  const workspace = validateWorkspacePutRequest({
    state: state("maa"),
    operbox: [{ id: "char_1", name: "测试干员", elite: 2, level: 80, own: true, potential: 1, rarity: 6 }],
    result: {
      profile: {},
      maa: {
        title: "test",
        plans: [{ name: "第一班", rooms: { training: [{ operators: ["不应导出"] }] } }],
      },
      rotation: { profile: "abc_12_6_6", shifts: [{ index: 0, duration_hours: 24 }] },
      trainingRoom: { schema_version: 1, shifts: [{ trainee: "能天使", trainer: "德克萨斯" }] },
      durationMs: 42,
      diagnosticId: "diagnostic-1",
    },
  });

  assert.ok("state" in workspace);
  assert.deepEqual(workspace.result?.trainingRoom, {
    schema_version: 1,
    shifts: [{ trainee: "能天使", trainer: "德克萨斯" }],
  });
  assert.equal("training" in (workspace.result?.maa.plans[0]?.rooms ?? {}), false);
});

test("saved plan context compares the effective Fiammetta setting", () => {
  const workspace = validateWorkspacePutRequest({
    state: { ...state("maa"), rotationProfile: "fiammetta_8_8_4_4", fiammettaEnabled: false },
    operbox: [{ id: "char_300422_fiamme", name: "菲亚梅塔", elite: 2, level: 80, own: true, potential: 1, rarity: 6 }],
    result: null,
  });
  assert.ok("state" in workspace);
  const context = validateSavedPlanCalculationContext({
    presetLabel: workspace.state.presetLabel,
    layout: workspace.state.layout,
    rotationProfile: workspace.state.rotationProfile,
    fiammettaEnabled: true,
  });
  assert.ok(context);
  assert.equal(workspaceMatchesSavedPlanContext(workspace.state, context, workspace.operbox), true);
});
