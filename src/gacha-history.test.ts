import assert from "node:assert/strict";
import test from "node:test";
import { formatGachaPoolPeriod, groupGachaPools, groupGachaSixStarIntervals, mergeGachaRecords, parseGachaRecord, visibleGachaIntervalKeys, type GachaRecord } from "./gacha-history.ts";

test("pool periods use CN calendar days, preserve cross-year ranges and reject missing dates", () => {
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(formatGachaPoolPeriod(seconds("2026-10-09T07:00:00Z"), seconds("2026-10-22T19:59:59Z")), "2026.10.09 – 10.23");
  assert.equal(formatGachaPoolPeriod(seconds("2026-12-31T07:00:00Z"), seconds("2027-01-13T19:59:59Z")), "2026.12.31 – 2027.01.14");
  assert.equal(formatGachaPoolPeriod(), null);
  assert.equal(formatGachaPoolPeriod(0, 100), null);
  assert.equal(formatGachaPoolPeriod(100, 99), null);
  const [pool] = groupGachaPools([{ ...draw(6, 0), poolId: "SINGLE_78_0_1" }]);
  assert.equal(pool.period, "2026.10.09 – 10.23");
  assert.equal(groupGachaPools([draw(6, 0)])[0].period, null);
});

test("ten-pull duplicates remain distinct and rarity is one-based", () => {
  const source = { poolId: "pool", poolName: "寻访", charId: "char", charName: "干员", rarity: 5, gachaTs: "1770697079082" };
  const first = parseGachaRecord({ ...source, pos: 0 }, "normal")!;
  const second = parseGachaRecord({ ...source, pos: 1 }, "normal")!;
  assert.equal(first.stars, 6);
  assert.equal(mergeGachaRecords([first], [first, second]).length, 2);
  assert.equal(parseGachaRecord({ ...source, gachaTs: "invalid", pos: 0 }, "normal"), null);
});

test("pools are grouped by actual pool ID, not broad category", () => {
  const base = { charId: "char", charName: "干员", rarity: 5, gachaTs: "1770697079082", pos: 0 };
  const first = parseGachaRecord({ ...base, poolId: "a", poolName: "甲池" }, "normal")!;
  const second = parseGachaRecord({ ...base, poolId: "b", poolName: "乙池" }, "normal")!;
  const groups = groupGachaPools([first, second]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.name), ["甲池", "乙池"]);
  assert.equal(groups[0]?.sixStars, 1);
});

test("known pool ID resolves only explicitly listed UP operators", () => {
  const record = parseGachaRecord({ poolId: "NORM_0_1_1", poolName: "标准寻访", charId: "char", charName: "干员", rarity: 2, gachaTs: "1770697079082", pos: 0 }, "normal")!;
  const [pool] = groupGachaPools([record]);
  assert.deepEqual(pool?.upSixStars, ["能天使", "安洁莉娜"]);
  assert.equal(pool?.sixStars, 0);
});

function draw(stars: number, pos: number): GachaRecord {
  return { id: `draw-${pos}`, category: "normal", poolId: "test", poolName: "测试", charId: `char-${stars}`, charName: `干员${stars}`, stars, isNew: false, timestamp: 1770697079082, pos };
}

test("six-star intervals retain repeats and count draws between chronological boundaries", () => {
  const records = [draw(3, 0), draw(6, 1), draw(5, 2), draw(5, 3), draw(4, 4), draw(6, 5), draw(3, 6)];
  const original = structuredClone(records);
  const intervals = groupGachaSixStarIntervals(records);
  assert.deepEqual(intervals.map(({ sixStar, lowerStars, drawCount, hasPreviousSixStar }) => ({
    six: sixStar?.pos ?? null, lower: lowerStars.map((record) => record.pos), drawCount, hasPreviousSixStar,
  })), [
    { six: null, lower: [6], drawCount: 1, hasPreviousSixStar: true },
    { six: 5, lower: [4, 3, 2], drawCount: 4, hasPreviousSixStar: true },
    { six: 1, lower: [0], drawCount: 2, hasPreviousSixStar: false },
  ]);
  assert.deepEqual(records, original);
  assert.equal(intervals.reduce((sum, interval) => sum + interval.drawCount, 0), records.length);
});

test("empty, unfinished, and consecutive six-star intervals do not invent prior boundaries", () => {
  assert.deepEqual(groupGachaSixStarIntervals([]), []);
  const [pending] = groupGachaSixStarIntervals([draw(3, 0), draw(4, 1)]);
  assert.equal(pending?.sixStar, null);
  assert.equal(pending?.drawCount, 2);
  assert.equal(pending?.hasPreviousSixStar, false);
  const consecutive = groupGachaSixStarIntervals([draw(6, 0), draw(6, 1)]);
  assert.deepEqual(consecutive.map((interval) => [interval.drawCount, interval.lowerStars.length, interval.hasPreviousSixStar]), [[1, 0, true], [1, 0, false]]);
});

test("multi-six-star tags require a complete ten-pull in the same pool, category and timestamp", () => {
  const batch = Array.from({ length: 10 }, (_, pos) => draw(pos === 2 || pos === 8 ? 6 : 4, pos));
  const highlights = (records: GachaRecord[]) => groupGachaSixStarIntervals(records).filter((interval) => interval.sixStar).map((interval) => interval.multiSixStarCount);
  assert.deepEqual(highlights(batch), [2, 2]);
  assert.deepEqual(highlights(batch.slice(1)), [0, 0]);
  for (const field of ["poolId", "category", "timestamp"] as const) {
    const split = batch.map((record, index) => index === 8
      ? { ...record, [field]: field === "timestamp" ? record.timestamp + 1 : "other" } : record);
    assert.deepEqual(highlights(split), [0, 0]);
  }
  assert.deepEqual(highlights(batch.map((record) => ({ ...record, pos: 0 }))), [0, 0]);
  assert.deepEqual(highlights([...batch, { ...batch[0], id: "duplicate" }]), [0, 0]);
  assert.deepEqual(highlights(batch.map((record, index) => index === 5 ? { ...record, stars: 6 } : record)), [3, 3, 3]);
});

test("off-banner tags apply only to six-stars outside a known pool's explicit UP list", () => {
  const record = { ...draw(6, 0), poolId: "NORM_0_1_1" };
  const tagged = (charName: string, poolId = record.poolId) => groupGachaSixStarIntervals([{ ...record, charName, poolId }])[0].offBanner;
  assert.equal(tagged("能天使"), false);
  assert.equal(tagged("安洁莉娜"), false);
  assert.equal(tagged("银灰"), true);
  assert.equal(tagged("银灰", "unknown-pool"), false);
  assert.equal(groupGachaSixStarIntervals([{ ...record, stars: 5 }])[0].offBanner, false);
});

test("pagination never splits a multi-six-star batch or includes a different pool at the same timestamp", () => {
  const batch = Array.from({ length: 10 }, (_, pos) => draw(pos === 2 || pos === 8 ? 6 : 4, pos));
  const newer = Array.from({ length: 9 }, (_, index) => ({ ...draw(6, 0), id: `newer-${index}`, timestamp: batch[0].timestamp + 1000 * (index + 1) }));
  const intervals = groupGachaSixStarIntervals([...newer, ...batch]).filter((interval) => interval.sixStar);
  const otherPool = groupGachaSixStarIntervals(batch.map((record) => ({ ...record, id: `other-${record.id}`, poolId: "other" }))).filter((interval) => interval.sixStar);
  const all = [...intervals, ...otherPool];
  assert.equal(visibleGachaIntervalKeys(all, 0).size, 0);
  assert.equal(visibleGachaIntervalKeys(all, 9).size, 9);
  const visible = visibleGachaIntervalKeys(all, 10);
  assert.equal(visible.size, 11);
  assert.ok(intervals.every((interval) => visible.has(interval.key)));
  assert.ok(otherPool.every((interval) => !visible.has(interval.key)));
  assert.equal(visibleGachaIntervalKeys(all, 12).size, 13);
});
