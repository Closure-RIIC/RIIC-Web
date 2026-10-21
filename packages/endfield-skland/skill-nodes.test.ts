import assert from "node:assert/strict";
import test from "node:test";
import { accountSkillIds, isSkillNodeUnlocked, parseSkillNodeId, resolvedSkillNodes, skillNodeId } from "./skill-nodes.ts";

// 佩丽卡的两个槽：1_1 α / 1_2 β(中枢)、2_1 β / 2_2 γ(制造)
const tiers = [
  { nodeId: "spaceship_skill_chr_0004_pelica_1_1", slot: 1, level: 1, unlock: 1 },
  { nodeId: "spaceship_skill_chr_0004_pelica_1_2", slot: 1, level: 2, unlock: 3 },
  { nodeId: "spaceship_skill_chr_0004_pelica_2_1", slot: 2, level: 1, unlock: 2 },
  { nodeId: "spaceship_skill_chr_0004_pelica_2_2", slot: 2, level: 2, unlock: 4 },
];

test("node ids parse into slot and level", () => {
  assert.deepEqual(parseSkillNodeId("spaceship_skill_chr_0004_pelica_2_1"), { slot: 2, level: 1 });
  assert.equal(parseSkillNodeId("fac_chr_0004_pelica_0_1"), null);
  assert.equal(skillNodeId({ slot: 1, level: 2, charId: "chr_x" }), "spaceship_skill_chr_x_1_2");
});

test("account nodes win over elite, and an empty list means nothing is unlocked", () => {
  // E4 但玩家只点了两个低档节点
  assert.deepEqual(
    resolvedSkillNodes(tiers, ["spaceship_skill_chr_0004_pelica_1_2", "spaceship_skill_chr_0004_pelica_2_1"], 4),
    ["spaceship_skill_chr_0004_pelica_1_2", "spaceship_skill_chr_0004_pelica_2_1"],
  );
  // 完全没点：即使 E4 也没有技能
  assert.deepEqual(resolvedSkillNodes(tiers, [], 4), []);
  // 不属于该干员的节点被忽略，重复项被去重
  assert.deepEqual(
    resolvedSkillNodes(tiers, ["spaceship_skill_chr_9999_other_1_1", "spaceship_skill_chr_0004_pelica_2_2", "spaceship_skill_chr_0004_pelica_2_2"], 0),
    ["spaceship_skill_chr_0004_pelica_2_2"],
  );
});

test("without account data each slot falls back to its highest unlocked tier", () => {
  assert.deepEqual(resolvedSkillNodes(tiers, undefined, 0), []);
  assert.deepEqual(resolvedSkillNodes(tiers, undefined, 2), ["spaceship_skill_chr_0004_pelica_1_1", "spaceship_skill_chr_0004_pelica_2_1"]);
  assert.deepEqual(resolvedSkillNodes(tiers, undefined, 4), ["spaceship_skill_chr_0004_pelica_1_2", "spaceship_skill_chr_0004_pelica_2_2"]);
});

test("unlock helpers match the resolved node list", () => {
  const unlocked = resolvedSkillNodes(tiers, ["spaceship_skill_chr_0004_pelica_1_2"], 0);
  assert.equal(isSkillNodeUnlocked(unlocked, "spaceship_skill_chr_0004_pelica_1_2"), true);
  assert.equal(isSkillNodeUnlocked(unlocked, "spaceship_skill_chr_0004_pelica_2_1"), false);
  assert.deepEqual(accountSkillIds([{ name: "佩丽卡", skillIds: ["a"] }], "佩丽卡"), ["a"]);
  assert.equal(accountSkillIds([{ name: "佩丽卡", elite: 4 } as never], "佩丽卡"), undefined);
});
