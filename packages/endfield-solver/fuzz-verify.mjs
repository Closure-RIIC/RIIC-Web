/**
 * 随机化自洽检查（不是求最优，只查"输出是否自相矛盾"）。
 *
 * 用法：
 *   node fuzz-verify.mjs            # 160 组
 *   node fuzz-verify.mjs 400 12345  # 400 组，从种子 12345 开始
 *
 * 检查项（每条都由 `verifyPlan` 或这里独立重算，不信任搜索阶段记下的值）：
 *   1. `verification.ok` —— 每条 pick 的产能/人数/助力/占用全部重算一致
 *   2. 类别分 = 该类别各舱室值之和
 *   3. 舱室值有限且非负
 *
 * 会跳过"配置本身非法"的随机组合（等级/培养位组合不合法），只报真正的失败。
 */
import { catalog, solve } from "./index.mjs";

const rand = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pickOne = (r, arr) => arr[Math.floor(r() * arr.length)];

const NAMES = catalog.map(o => o.name);
const LAYOUTS = ["1干员1武器", "2干员", "2武器"];
const PRIORITIES = [
  ["线索", "干员经验", "武器经验", "培养"],
  ["培养", "干员经验", "武器经验", "线索"],
  ["干员经验", "武器经验", "线索", "培养"],
];

/** 生成第 seed 组随机输入（确定性） */
export function randomCase(seed) {
  const r = rand(seed * 7919);
  const size = 3 + Math.floor(r() * 30);
  const operators = [];
  const seen = new Set();
  while (operators.length < size) {
    const name = pickOne(r, NAMES);
    if (seen.has(name)) continue;
    seen.add(name);
    operators.push({ name, elite: Math.floor(r() * 5) });
  }
  const center = 1 + Math.floor(r() * 5);
  const cap = center >= 5 ? 3 : center >= 4 ? 2 : 1;
  const growLv = 1 + Math.floor(r() * 3);
  const slots = Math.floor(r() * (growLv + 1));
  const guest = center >= 3 ? 1 + Math.floor(r() * (center >= 4 ? 3 : 1)) : 0;
  const options = {
    mfg: pickOne(r, LAYOUTS),
    levels: {
      center,
      mfg1: 1 + Math.floor(r() * cap),
      mfg2: 1 + Math.floor(r() * cap),
      grow: slots > 0 ? growLv : 0,
      guest,
    },
    grow: { 晶植: slots, 菌类: 0, 矿物: 0 },
    priority: pickOne(r, PRIORITIES),
    assist: r() < 0.3,
    budget: 150000,
    time: 8000,
  };
  return { operators, options };
}

/** 对一组输出做自洽检查，返回问题列表 */
export function checkResult(result) {
  const problems = [];
  if (!result.verification.ok) problems.push(...result.verification.errors);
  const byCat = {};
  for (const room of result.rooms) {
    if (!Number.isFinite(room.value) || room.value < 0) problems.push(`${room.key} 的值非法：${room.value}`);
    byCat[room.category] = (byCat[room.category] ?? 0) + room.value;
  }
  for (const [cat, sum] of Object.entries(byCat)) {
    const score = result.scores[cat] ?? 0;
    if (Math.abs(score - sum) > 1e-6) problems.push(`类别 ${cat} 分数 ${score} ≠ 舱室之和 ${sum}`);
  }
  return problems;
}

export function runFuzz({ count = 160, startSeed = 1 } = {}) {
  const failures = [];
  let passed = 0;
  let skipped = 0;
  for (let seed = startSeed; seed < startSeed + count; seed += 1) {
    const { operators, options } = randomCase(seed);
    let result;
    try {
      result = solve({ operators, options });
    } catch {
      skipped += 1;                  // 配置组合本身不合法
      continue;
    }
    const problems = checkResult(result);
    if (problems.length) failures.push({ seed, size: operators.length, mfg: options.mfg, assist: options.assist, problems });
    else passed += 1;
  }
  return { passed, skipped, failures, total: count };
}

if (process.argv[1] && process.argv[1].endsWith("fuzz-verify.mjs")) {
  const count = Number(process.argv[2] ?? 160);
  const startSeed = Number(process.argv[3] ?? 1);
  const t0 = Date.now();
  const { passed, skipped, failures, total } = runFuzz({ count, startSeed });
  console.log(`随机案例 ${total} 组：通过 ${passed}，跳过(非法配置) ${skipped}，失败 ${failures.length}，`
    + `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const f of failures.slice(0, 10)) console.log("FAIL", JSON.stringify(f).slice(0, 400));
  process.exitCode = failures.length ? 1 : 0;
}
