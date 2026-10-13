import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGachaHistory, gachaLuck, gachaPoolKind, gachaStatistics, nextSixStarProbability } from "./gacha-analytics.ts";
import type { GachaRecord } from "./gacha-history.ts";

function draw(poolId: string, stars: number, timestamp: number, charName = "芬", pos = 0): GachaRecord {
  return { id: `${poolId}:${timestamp}:${pos}`, category: "normal", poolId, poolName: poolId, charId: charName,
    charName, stars, isNew: false, timestamp, pos };
}

test("site luck ratings use unrounded boundary values and clamp the transparent score", () => {
  for (const [average, label] of [[1, "至尊欧皇"], [10, "至尊欧皇"], [10.01, "天选欧皇"], [19, "天选欧皇"], [20, "天选欧皇"], [20.01, "鸿运当头"], [30, "鸿运当头"], [30.01, "欧气渐盛"], [40, "欧气渐盛"], [40.01, "小有欧气"], [50, "小有欧气"], [50.01, "平平无奇"], [60, "平平无奇"], [60.01, "时运不济"], [70, "时运不济"], [70.01, "非酋本酋"], [80, "非酋本酋"], [80.01, "资深非酋"], [90, "资深非酋"], [90.01, "究极非酋"], [100, "究极非酋"]] as const) {
    assert.equal(gachaLuck(average)?.label, label);
    assert.equal(gachaLuck(average)?.score, 100 - average);
  }
  assert.equal(gachaLuck(120)?.score, 0);
  for (const [average, tone] of [[1, "lucky"], [40, "lucky"], [40.01, "normal"], [60, "normal"], [60.01, "unlucky"], [120, "unlucky"]] as const) {
    assert.equal(gachaLuck(average)?.tone, tone);
  }
  for (const value of [null, 0, -1, NaN, Infinity]) assert.equal(gachaLuck(value), null);
});

test("pool rules separate shared pity from limited, linkage and special pools", () => {
  assert.equal(gachaPoolKind("SINGLE_78_0_1"), "standard");
  assert.equal(gachaPoolKind("DOUBLE_77_0_5"), "standard");
  assert.equal(gachaPoolKind("CLASSIC_DOUBLE_78_0_1"), "classic");
  assert.equal(gachaPoolKind("FESCLASSIC_38_0_2"), "classic");
  assert.equal(gachaPoolKind("LIMITED_76_0_1"), "limited");
  assert.equal(gachaPoolKind("LINKAGE_77_0_1"), "linkage");
  for (const id of ["ATTAIN_68_0_4", "CLASSIC_ATTAIN_68_0_2", "SPECIAL_54_0_5", "unknown"]) assert.equal(gachaPoolKind(id), "other");
});

test("shared standard pity carries across banners but does not consume classic or limited draws", () => {
  const records = [draw("SINGLE_78_0_1", 3, 80), draw("CLASSIC_DOUBLE_78_0_1", 3, 70),
    draw("LIMITED_76_0_1", 6, 60), draw("DOUBLE_77_0_5", 5, 50), draw("DOUBLE_77_0_5", 6, 40, "斥罪"),
    draw("CLASSIC_DOUBLE_78_0_1", 6, 30, "棘刺")];
  const before = structuredClone(records);
  const stats = analyzeGachaHistory(records);
  assert.equal(stats.kinds.find((kind) => kind.id === "standard")?.pity, 2);
  assert.equal(stats.kinds.find((kind) => kind.id === "classic")?.pity, 1);
  assert.equal(stats.pools.get("normal:SINGLE_78_0_1")?.pity, 1);
  assert.equal(stats.pools.get("normal:SINGLE_78_0_1")?.pityAtLeast, true);
  assert.equal(stats.kinds.reduce((sum, kind) => sum + kind.draws, 0), records.length);
  assert.deepEqual(records, before);
});

test("UP averages and lost counts exclude unclassifiable pools and include repeated six-stars", () => {
  const records = [draw("SINGLE_78_0_1", 6, 30, "克莱门莎", 0), draw("SINGLE_78_0_1", 6, 30, "克莱门莎", 1),
    draw("SINGLE_78_0_1", 6, 30, "能天使", 2), draw("SINGLE_78_0_1", 3, 30, "芬", 3),
    draw("unknown", 6, 40, "能天使"), draw("unknown", 3, 50)];
  assert.deepEqual(gachaStatistics(records), {
    draws: 6, sixCount: 4, upCount: 2, offCount: 1, unknownSixCount: 1,
    pity: 1, pityAtLeast: false, completedSixDraws: 4, completedUpDraws: 2, sixAverage: 1, upAverage: 1, offRate: 1 / 3,
  });
});

test("limited summary includes linkage draws without merging independent pity or averaging averages", () => {
  const records = [draw("LIMITED_76_0_1", 3, 1), draw("LIMITED_76_0_1", 6, 2, "珊比"), draw("LIMITED_76_0_1", 3, 3),
    draw("LINKAGE_77_0_1", 3, 4), draw("LINKAGE_77_0_1", 3, 5), draw("LINKAGE_77_0_1", 6, 6, "结城理"),
    draw("LINKAGE_77_0_1", 6, 7, "能天使"), draw("LINKAGE_77_0_1", 3, 8)];
  const analysis = analyzeGachaHistory(records, Date.parse("2026-09-05T00:00:00Z"));
  const limited = analysis.kinds.find((kind) => kind.id === "limited")!;
  assert.equal(analysis.kinds.some((kind) => kind.id === "linkage"), false);
  assert.equal(limited.draws, 8);
  assert.equal(limited.sixCount, 3);
  assert.equal(limited.upCount, 2);
  assert.equal(limited.offCount, 1);
  assert.equal(limited.sixAverage, 2);
  assert.equal(limited.upAverage, 2.5);
  assert.equal(analysis.kinds.reduce((sum, kind) => sum + kind.draws, 0), records.length);
  assert.equal(analysis.pools.get("normal:LIMITED_76_0_1")?.pity, 1);
  assert.equal(analysis.pools.get("normal:LINKAGE_77_0_1")?.pity, 1);
  assert.equal(analysis.pityTracks.find((track) => track.id === "LINKAGE_77_0_1")?.count, 1);
});

test("empty or never-six archives avoid fabricated averages or exact pity", () => {
  const empty = gachaStatistics([]);
  assert.equal(empty.upAverage, null);
  assert.equal(empty.sixAverage, null);
  assert.equal(empty.offRate, null);
  assert.equal(empty.pityAtLeast, false);
  const missing = gachaStatistics([draw("SINGLE_78_0_1", 3, 10), draw("SINGLE_78_0_1", 5, 20)]);
  assert.equal(missing.pity, 2);
  assert.equal(missing.pityAtLeast, true);
  assert.equal(missing.upAverage, null);
});

test("same timestamp uses ten-pull position and independent pools keep separate tails", () => {
  const records = [draw("LIMITED_76_0_1", 3, 100, "芬", 2), draw("LIMITED_76_0_1", 6, 100, "能天使", 1),
    draw("LIMITED_76_0_1", 5, 100, "火哨", 0), draw("LINKAGE_77_0_1", 3, 200)];
  const stats = analyzeGachaHistory(records, Date.parse("2026-08-02T00:00:00Z"));
  assert.equal(stats.pools.get("normal:LIMITED_76_0_1")?.pity, 1);
  assert.equal(stats.pools.get("normal:LINKAGE_77_0_1")?.pityAtLeast, true);
  assert.equal(stats.pools.get("normal:LIMITED_76_0_1")?.active, true);
  assert.equal(analyzeGachaHistory(records, Date.parse("2026-10-01T00:00:00Z")).pools.get("normal:LIMITED_76_0_1")?.active, false);
});

test("reference 75 classic draws with 21 pity and two six-stars average 27, not 37.5", () => {
  const records = Array.from({ length: 75 }, (_, index) => draw("CLASSIC_DOUBLE_78_0_1", [26, 53].includes(index) ? 6 : 3, index + 1, "棘刺"));
  const stats = gachaStatistics(records);
  assert.equal(stats.pity, 21);
  assert.equal(stats.completedSixDraws, 54);
  assert.equal(stats.sixAverage, 27);
});

test("reference standard example excludes two unfinished draws from its UP average", () => {
  const sixPositions = new Map(Array.from({ length: 27 }, (_, index) => [Math.floor((index + 1) * 1012 / 27) - 1, index % 2 === 0]));
  const records = Array.from({ length: 1014 }, (_, index) => draw("SINGLE_78_0_1", sixPositions.has(index) ? 6 : 3,
    index + 1, sixPositions.get(index) ? "克莱门莎" : "能天使"));
  const stats = gachaStatistics(records);
  assert.equal(stats.sixCount, 27);
  assert.equal(stats.offCount, 13);
  assert.equal(stats.pity, 2);
  assert.equal(stats.upAverage?.toFixed(1), "72.3");
});

test("independent pool tails never enter another pool's six-star or UP average", () => {
  const records = [draw("LIMITED_76_0_1", 3, 1), draw("LIMITED_76_0_1", 6, 2, "丰川祥子"),
    draw("LIMITED_76_0_1", 3, 3), draw("LINKAGE_77_0_1", 3, 4), draw("LINKAGE_77_0_1", 6, 5, "结城理"),
    draw("LINKAGE_77_0_1", 3, 6), draw("SINGLE_78_0_1", 3, 7)];
  const stats = gachaStatistics(records);
  assert.equal(stats.completedSixDraws, 4);
  assert.equal(stats.sixAverage, 2);
  assert.equal(stats.completedUpDraws, 2);
  assert.equal(stats.upAverage, 2);
});

test("UP average excludes later off-banner six-stars as well as the pending tail", () => {
  const records = [draw("SINGLE_78_0_1", 3, 1), draw("SINGLE_78_0_1", 6, 2, "克莱门莎"),
    draw("SINGLE_78_0_1", 6, 3, "能天使"), draw("SINGLE_78_0_1", 3, 4)];
  const stats = gachaStatistics(records);
  assert.equal(stats.sixAverage, 1.5);
  assert.equal(stats.upAverage, 2);
});

test("full spark achievements count each 300 saved draws within a limited banner only", () => {
  const saved = (poolId: string, count: number) => Array.from({ length: count }, (_, index) => draw(poolId, 3, index));
  for (const [count, expected] of [[0, 0], [299, 0], [300, 1], [599, 1], [600, 2]]) {
    assert.equal(analyzeGachaHistory(saved("LIMITED_76_0_1", count)).achievements.fullSparks, expected);
  }
  assert.equal(analyzeGachaHistory([...saved("LIMITED_76_0_1", 150), ...saved("LIMITED_73_0_1", 150)]).achievements.fullSparks, 0);
  assert.equal(analyzeGachaHistory([...saved("LIMITED_76_0_1", 600), ...saved("LIMITED_73_0_1", 300)]).achievements.fullSparks, 3);
  for (const poolId of ["SINGLE_78_0_1", "CLASSIC_DOUBLE_78_0_1", "LINKAGE_77_0_1", "SPECIAL_77_0_4", "unknown"]) {
    assert.equal(analyzeGachaHistory(saved(poolId, 300)).achievements.fullSparks, 0);
  }
});

test("pity chance follows the 50-failure boundary without inventing values for invalid records", () => {
  for (const [count, chance] of [[0, 2], [21, 2], [49, 2], [50, 4], [51, 6], [98, 100]]) assert.equal(nextSixStarProbability(count), chance);
  for (const count of [-1, 99, 100, NaN, 0.5]) assert.equal(nextSixStarProbability(count), null);
});

test("expired limited banners do not feed current pity; incomplete ten-pulls do not grant achievements", () => {
  const records = Array.from({ length: 10 }, (_, pos) => draw("LINKAGE_77_0_1", pos < 2 ? 6 : 3, 100, pos < 2 ? "结城理" : "芬", pos));
  const stats = analyzeGachaHistory(records, Date.parse("2026-10-10T00:00:00Z"));
  assert.deepEqual(stats.achievements.multiSix, [[2, 1]]);
  assert.equal(stats.achievements.longestUpStreak, 2);
  assert.equal(stats.current.draws, 0);
  assert.equal(stats.pityTracks.find((track) => track.id === "limited")?.count, null);
  assert.deepEqual(analyzeGachaHistory(records.slice(1)).achievements.multiSix, []);
});
