import assert from "node:assert/strict";
import test from "node:test";
import {
  accountSkillNodes, effectiveSkillNodes, isSkillNodeUnlocked, parseSkillNodeId, reconcileSkillNodes,
  requiredElite, skillNodeId, toggleSkillNode, unlockedSkillNodes,
} from "./skill-nodes.ts";

// 佩丽卡的两个槽：1_1 α(E1) / 1_2 β(E3)（中枢）、2_1 β(E2) / 2_2 γ(E4)（制造）
const P = (tail: string) => `spaceship_skill_chr_0004_pelica_${tail}`;
const tiers = [
  { nodeId: P("1_1"), slot: 1, level: 1, unlock: 1 },
  { nodeId: P("1_2"), slot: 1, level: 2, unlock: 3 },
  { nodeId: P("2_1"), slot: 2, level: 1, unlock: 2 },
  { nodeId: P("2_2"), slot: 2, level: 2, unlock: 4 },
];
// catalog 里的技能只带 nodeId / unlock，没有 slot / level 字段
const catalogLike = tiers.map(({ nodeId, unlock }) => ({ nodeId, unlock }));

test("node ids parse into slot and level", () => {
  assert.deepEqual(parseSkillNodeId(P("2_1")), { slot: 2, level: 1 });
  assert.equal(parseSkillNodeId("fac_chr_0004_pelica_0_1"), null);
  assert.equal(skillNodeId({ slot: 1, level: 2, charId: "chr_x" }), "spaceship_skill_chr_x_1_2");
});

test("clicking a slot switches it: replace, downgrade, remove", () => {
  // 状态 1_1 + 2_2，点 1_2 → 该槽没有 1_2，用 1_2 替换 1_1
  assert.deepEqual(toggleSkillNode(tiers, [P("1_1"), P("2_2")], P("1_2")), [P("1_2"), P("2_2")]);
  // 状态 1_2 + 2_2，点 2_1 → 用 2_1 替换 2_2
  assert.deepEqual(toggleSkillNode(tiers, [P("1_2"), P("2_2")], P("2_1")), [P("1_2"), P("2_1")]);
  // 状态 1_2 + 2_1，点 1_2（已存）→ 降到 1_1
  assert.deepEqual(toggleSkillNode(tiers, [P("1_2"), P("2_1")], P("1_2")), [P("1_1"), P("2_1")]);
  // 状态 1_1 + 2_1，点 2_1（已存且是最低档）→ 删掉这个槽
  assert.deepEqual(toggleSkillNode(tiers, [P("1_1"), P("2_1")], P("2_1")), [P("1_1")]);
  // 状态只有 2_2（1 槽未解锁），点 1_2 → 加入
  assert.deepEqual(toggleSkillNode(tiers, [P("2_2")], P("1_2")), [P("1_2"), P("2_2")]);
  // 空状态点 1_1 → 加入
  assert.deepEqual(toggleSkillNode(tiers, [], P("1_1")), [P("1_1")]);
  // 非法/异名节点被忽略
  assert.deepEqual(toggleSkillNode(tiers, [P("1_1")], "spaceship_skill_chr_9999_x_1_1"), [P("1_1")]);
  assert.deepEqual(toggleSkillNode(tiers, [P("1_1")], "random"), [P("1_1")]);
});

test("unlocked nodes expand the lower tier of every slot", () => {
  // 状态只存最高档，展示时低档也点亮
  assert.deepEqual(
    unlockedSkillNodes(tiers, { elite: 4, latestSpaceshipSkillNodes: [P("1_2"), P("2_1")] }),
    [P("1_1"), P("1_2"), P("2_1")],
  );
  // catalog 形态（只有 nodeId/unlock）同样能展开
  assert.deepEqual(unlockedSkillNodes(catalogLike, { elite: 4, latestSpaceshipSkillNodes: [P("1_2")] }), [P("1_1"), P("1_2")]);
  // 空数组 = 一个都没解锁
  assert.deepEqual(unlockedSkillNodes(tiers, { elite: 4, latestSpaceshipSkillNodes: [] }), []);
});

test("without account data every slot falls back to its highest unlocked tier", () => {
  assert.deepEqual(unlockedSkillNodes(tiers, { elite: 0 }), []);
  assert.deepEqual(unlockedSkillNodes(tiers, { elite: 2 }), [P("1_1"), P("2_1")]);
  assert.deepEqual(unlockedSkillNodes(tiers, { elite: 4 }), [P("1_1"), P("1_2"), P("2_1"), P("2_2")]);
});

test("unlocking a higher tier raises the elite stage, never lowers it", () => {
  // E1 点 1_2（需要 E3）→ 要求提到 E3
  assert.equal(requiredElite(tiers, [P("1_2")], 1), 3);
  // 2_2 需要 E4
  assert.equal(requiredElite(tiers, [P("2_2")], 2), 4);
  // 已经足够时不降低
  assert.equal(requiredElite(tiers, [P("1_1")], 4), 4);
  assert.equal(requiredElite(tiers, [], 3), 3);
});

test("lowering the elite stage reconciles skills that can no longer be unlocked", () => {
  const maxed = [P("1_2"), P("2_2")];
  // E4 → E2：1_2 需要 E3，降到 1_1；2_2 需要 E4，降到 2_1
  assert.deepEqual(reconcileSkillNodes(tiers, maxed, 2), [P("1_1"), P("2_1")]);
  // E4 → E1：1_2 → 1_1；2 槽最低要 E2，整槽取消
  assert.deepEqual(reconcileSkillNodes(tiers, maxed, 1), [P("1_1")]);
  // E4 → E0：两个槽都解锁不了，全部取消
  assert.deepEqual(reconcileSkillNodes(tiers, maxed, 0), []);
  // 提高精英化不补技能
  assert.deepEqual(reconcileSkillNodes(tiers, [P("1_1")], 4), [P("1_1")]);
  // 本来就合法的保持不变
  assert.deepEqual(reconcileSkillNodes(tiers, [P("1_1"), P("2_1")], 3), [P("1_1"), P("2_1")]);
});

test("effective nodes keep only the highest tier per slot", () => {
  const nodes = [P("1_2"), P("2_1")];
  assert.deepEqual(effectiveSkillNodes(tiers, { elite: 4, latestSpaceshipSkillNodes: nodes }), nodes);
  assert.deepEqual(
    effectiveSkillNodes(tiers, { elite: 4, latestSpaceshipSkillNodes: [P("1_1"), P("1_2")] }),
    [P("1_2")],
  );
  assert.deepEqual(effectiveSkillNodes(tiers, { elite: 4, latestSpaceshipSkillNodes: [] }), []);
});

test("unlock helpers match the resolved node list", () => {
  const unlocked = unlockedSkillNodes(tiers, { elite: 0, latestSpaceshipSkillNodes: [P("1_2")] });
  assert.equal(isSkillNodeUnlocked(unlocked, P("1_1")), true);
  assert.equal(isSkillNodeUnlocked(unlocked, P("2_1")), false);
  assert.deepEqual(accountSkillNodes([{ name: "佩丽卡", elite: 4, latestSpaceshipSkillNodes: [P("1_1")] }], "佩丽卡"), [P("1_1")]);
  assert.equal(accountSkillNodes([{ name: "佩丽卡", elite: 4 }], "佩丽卡"), undefined);
});
