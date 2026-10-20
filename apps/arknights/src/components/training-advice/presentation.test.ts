import assert from "node:assert/strict";
import test from "node:test";

import {
  trainingAcquisitionLabel,
  trainingCombinationStateLabel,
  trainingConditionStatusLabel,
  trainingLevelText,
  trainingMemberProgressLabel,
  trainingMemberRoleLabel,
  trainingPriorityLabel,
  trainingProductLabel,
  trainingReasonLabel,
  trainingScaleLabel,
} from "./presentation.ts";
import type { TrainingCombination, TrainingRecommendation } from "@/types";
import { parseTrainingAdviceReport } from "../../training-advice-contract.ts";
import { legacyTrainingTarget, trainingAdviceSkillSummary } from "./skill-selection.ts";
import { recommendationCurrentState, recommendationMessage } from "./recommendation-presentation.ts";
import type { OperBoxEntry, UserProfileAction } from "../../types.ts";

const target = { kind: "explicit" as const, elite: 1, level: 30 };

const promotionAction: UserProfileAction = {
  priority: "综合", kind: "promote_tier_up", operator: "乌有", domain_id: "general",
  message: "将「乌有」升至 tier_up（需精2）——贸易订单/源石钱参考组合成员，现5★精0 1级",
  current_elite: 0, tier_up_requirement: "精2",
};

test("promotion copy replaces the wire token and retains combination and level details", () => {
  assert.equal(recommendationMessage(promotionAction), "将「乌有」升至精二——贸易订单/源石钱参考组合成员，目前精零 1级（5★）");
  assert.equal(recommendationCurrentState(promotionAction), "目前精零 · 目标精二");
  assert.equal(recommendationCurrentState({ ...promotionAction, current_elite: 1 }), "目前精一 · 目标精二");
  assert.equal(recommendationMessage({ ...promotionAction, tier_up_requirement: "精1" }).includes("升至精一"), true);
  assert.equal(recommendationMessage({ ...promotionAction, tier_up_requirement: undefined }), recommendationMessage(promotionAction));
  assert.match(recommendationMessage(promotionAction, true), /Promote to Elite 2/);
});

test("promotion copy does not invent unknown elite stages or replace ordinary advice", () => {
  const unknown = { ...promotionAction, current_elite: undefined, tier_up_requirement: undefined, message: "升至 tier_up" };
  assert.equal(recommendationMessage(unknown), "升至 目标精英阶段");
  assert.equal(recommendationCurrentState(unknown), "练度未知");
  assert.equal(recommendationMessage({ ...promotionAction, message: "保留发电站轮换位。" }), "保留发电站轮换位。");
  const entry: OperBoxEntry = { id: "test", name: "乌有", elite: 1, level: 50, own: true, potential: 1, rarity: 5 };
  assert.equal(recommendationCurrentState({ ...promotionAction, current_elite: undefined }, entry), "目前精一 · 目标精二");
  assert.equal(recommendationCurrentState(promotionAction, { ...entry, own: false }), "未拥有");
});

test("maps every schema v2 wire enum used by the presentation", () => {
  assert.equal(trainingProductLabel("trade"), "贸易");
  assert.equal(trainingProductLabel("general_manufacturing"), "制造");
  assert.equal(trainingProductLabel("originium_shards"), "源石碎片");
  assert.equal(trainingProductLabel(), "综合");
  assert.equal(trainingScaleLabel("system"), "体系组合");
  assert.equal(trainingScaleLabel("small"), "小型组合");
  assert.equal(trainingMemberRoleLabel("core"), "核心");
  assert.equal(trainingMemberRoleLabel("important"), "重要");
  assert.equal(trainingMemberRoleLabel("secondary"), "次级");
  assert.equal(trainingMemberRoleLabel("hanger"), "挂件");
  assert.equal(trainingCombinationStateLabel("needs_review"), "待核对");
  assert.equal(trainingMemberProgressLabel("needs_review"), "待核对");
  assert.equal(trainingReasonLabel("newbie_required"), "新手必需");
  assert.equal(trainingReasonLabel("combination_core"), "组合核心");
  assert.equal(trainingReasonLabel("combination_important"), "组合重要");
  assert.equal(trainingReasonLabel("standalone"), "独立推荐");
  assert.equal(trainingPriorityLabel("automation_must_train"), "自动化必练");
  assert.equal(trainingAcquisitionLabel("public_recruitment"), "公开招募");
  assert.equal(trainingConditionStatusLabel("unknown"), "待确认");
});

test("formats all target kinds without exposing protocol values", () => {
  assert.equal(trainingLevelText({ kind: "explicit", elite: 2 }), "精2");
  assert.equal(trainingLevelText(target), "精1 Lv30");
  assert.equal(trainingLevelText({ kind: "no_requirement" }), "无需额外培养");
  assert.equal(trainingLevelText({ kind: "derive_from_skill_binding" }), "按技能解锁要求");
  assert.equal(trainingLevelText({ kind: "needs_review" }), "目标待核对");
});

test("preserves the server-defined combination and recommendation order", () => {
  const combinations: TrainingCombination[] = [
    {
      id: "complete-first",
      name: "服务端第一项",
      scale: "small",
      state: "complete",
      completed_slots: 1,
      total_slots: 1,
      completion_percent: 100,
      facilities: [],
      members: [],
    },
    {
      id: "missing-second",
      name: "服务端第二项",
      scale: "system",
      state: "missing_core",
      completed_slots: 0,
      total_slots: 2,
      completion_percent: 0,
      facilities: [],
      members: [],
    },
  ];
  const recommendations: TrainingRecommendation[] = [
    {
      operator: "服务端第一名",
      action: "train",
      target,
      priority: "lower_priority_core",
      priority_rank: 90,
      reason: "combination_core",
    },
    {
      operator: "服务端第二名",
      action: "train",
      target,
      priority: "newbie_four_star_elite_one",
      priority_rank: 10,
      reason: "newbie_required",
    },
  ];

  const report = parseTrainingAdviceReport({
    schema_version: 2,
    context: {},
    newbie_section_status: "complete",
    incomplete_newbie: [],
    combinations,
    recommendations,
  });
  assert.deepEqual(report.combinations.map((item) => item.id), ["complete-first", "missing-second"]);
  assert.deepEqual(report.recommendations.map((item) => item.operator), ["服务端第一名", "服务端第二名"]);
});

test("marks the infrastructure skill unlocked by the recommended training target", () => {
  const summary = trainingAdviceSkillSummary(
    "清流",
    { elite: 0, level: 30 },
    { kind: "explicit", elite: 1, level: 1 },
  );

  assert.deepEqual(
    summary.skills.filter((skill) => summary.highlightedSkillIds.includes(skill.id)).map((skill) => skill.name),
    ["再生能源"],
  );
});

test("legacy training requirements are parsed without guessing missing targets", () => {
  assert.deepEqual(legacyTrainingTarget("需精2"), { kind: "explicit", elite: 2, level: 1 });
  assert.deepEqual(legacyTrainingTarget("Elite 1"), { kind: "explicit", elite: 1, level: 1 });
  assert.equal(legacyTrainingTarget("按技能要求"), undefined);
  assert.equal(legacyTrainingTarget("提升 2 级"), undefined);
});
