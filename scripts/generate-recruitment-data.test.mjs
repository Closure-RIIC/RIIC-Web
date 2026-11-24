import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const generator = path.resolve(import.meta.dirname, "generate-recruitment-data.mjs");
const snapshotPath = "apps/arknights/src/generated/recruitment-data.json";
const manifestPath = "packages/arknights-domain/src/generated/arkntools/source.json";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "recruitment-data-test-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const sourceRoot = path.join(root, "source");
  async function json(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  const characters = {};
  const catalog = [];
  for (let index = 0; index < 104; index += 1) {
    const id = `${String(index).padStart(3, "0")}_test`;
    const rarity = index === 0 ? 6 : index === 1 ? 5 : 4;
    catalog.push({ id: `char_${id}`, name: `Operator ${index}`, rarity });
    characters[id] = { star: rarity, profession: 5, position: 9, tags: [16, 16, 22], recruitment: { cn: index === 103 ? 0 : 1 } };
  }
  await json(path.join(sourceRoot, "assets/data/character.json"), characters);
  const tags = { 5: "辅助干员", 9: "近战位", 11: "高级资深干员", 14: "资深干员", 16: "支援", 22: "防护" };
  await json(path.join(sourceRoot, "assets/locales/cn/tag.json"), tags);
  await json(path.join(sourceRoot, "assets/locales/us/tag.json"), { 5: "Supporter", 9: "Melee", 11: "Top Operator", 14: "Senior Operator", 16: "Support", 22: "Defense" });
  const git = (...args) => execFileSync("git", args, { cwd: sourceRoot, encoding: "utf8", stdio: "pipe" });
  git("init", "--quiet");
  const source = { repository: "https://github.com/arkntools/arknights-toolbox-data", commit: "" };
  async function commitSource() {
    git("add", ".");
    git("-c", "user.name=Recruitment test", "-c", "user.email=recruitment@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    source.commit = git("rev-parse", "HEAD").trim();
    await json(path.join(root, manifestPath), { source });
  }
  await commitSource();
  await json(path.join(root, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), catalog);
  await mkdir(path.join(root, path.dirname(snapshotPath)), { recursive: true });
  const run = (...args) => spawnSync(process.execPath, [generator, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
  const load = () => readFile(path.join(root, snapshotPath), "utf8").then(JSON.parse);
  return { root, sourceRoot, source, json, run, load, characters, commitSource };
}

test("generates the CN pool offline from the pinned checkout with localized and deduplicated tags", async (t) => {
  const f = await fixture(t);
  const generated = f.run("--source", f.sourceRoot);
  assert.equal(generated.status, 0, generated.stderr);
  const data = await f.load();
  assert.deepEqual(data.source, f.source);
  assert.equal(data.operators.length, 103);
  assert.equal(data.server, "cn");
  assert.ok(!data.operators.some((operator) => operator.id === "char_103_test"));
  assert.deepEqual(data.operators[0].tags, [5, 9, 11, 16, 22]);
  assert.deepEqual(data.operators[1].tags, [5, 9, 14, 16, 22]);
  assert.deepEqual(data.operators[2].tags, [5, 9, 16, 22]);
  assert.ok(data.tags.every((tag) => tag.zh && tag.en));
  for (const args of [["--check"], ["--check", "--source", f.sourceRoot]]) {
    const checked = f.run(...args);
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("offline checks reject a stale snapshot and source checkout without overwriting the snapshot", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("--source", f.sourceRoot).status, 0);
  const before = await readFile(path.join(f.root, snapshotPath), "utf8");
  await f.json(path.join(f.root, manifestPath), { source: { ...f.source, commit: "a".repeat(40) } });
  for (const args of [["--check"], ["--source", f.sourceRoot]]) {
    const failed = f.run(...args);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Regenerate recruitment data|checkout must match/);
    assert.equal(await readFile(path.join(f.root, snapshotPath), "utf8"), before);
  }
});

test("checking against the source detects a missing recruit even when the snapshot revision matches", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("--source", f.sourceRoot).status, 0);
  const data = await f.load();
  data.operators.pop();
  await f.json(path.join(f.root, snapshotPath), data);
  const failed = f.run("--check", "--source", f.sourceRoot);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Regenerate recruitment data after updating the recruitment pool/);
  assert.equal((await f.load()).operators.length, 102);
});

for (const removal of ["eligibility", "record"]) {
  test(`blocks an upstream recruitment ${removal} removal unless explicitly confirmed`, async (t) => {
    const f = await fixture(t);
    assert.equal(f.run("--source", f.sourceRoot).status, 0);
    const before = await readFile(path.join(f.root, snapshotPath), "utf8");
    if (removal === "eligibility") f.characters["050_test"].recruitment.cn = 0;
    else delete f.characters["050_test"];
    await f.json(path.join(f.sourceRoot, "assets/data/character.json"), f.characters);
    await f.commitSource();
    const blocked = f.run("--source", f.sourceRoot);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /char_050_test/);
    assert.match(blocked.stderr, /--allow-removals/);
    assert.equal(await readFile(path.join(f.root, snapshotPath), "utf8"), before);

    const confirmed = f.run("--source", f.sourceRoot, "--allow-removals");
    assert.equal(confirmed.status, 0, confirmed.stderr);
    const data = await f.load();
    assert.equal(data.operators.length, 102);
    assert.ok(!data.operators.some((operator) => operator.id === "char_050_test"));
    assert.deepEqual(data.source, f.source);
    const checked = f.run("--source", f.sourceRoot, "--check");
    assert.equal(checked.status, 0, checked.stderr);
  });
}

test("blocks removal even when another recruit keeps the pool count unchanged", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("--source", f.sourceRoot).status, 0);
  const before = await readFile(path.join(f.root, snapshotPath), "utf8");
  f.characters["050_test"].recruitment.cn = 0;
  f.characters["103_test"].recruitment.cn = 1;
  await f.json(path.join(f.sourceRoot, "assets/data/character.json"), f.characters);
  await f.commitSource();
  const blocked = f.run("--source", f.sourceRoot);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /char_050_test/);
  assert.equal(await readFile(path.join(f.root, snapshotPath), "utf8"), before);
  const confirmed = f.run("--source", f.sourceRoot, "--allow-removals");
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal((await f.load()).operators.length, 103);
});

test("accepts a legitimate recruitment expansion without the removal override", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("--source", f.sourceRoot).status, 0);
  f.characters["103_test"].recruitment.cn = 1;
  await f.json(path.join(f.sourceRoot, "assets/data/character.json"), f.characters);
  await f.commitSource();
  const generated = f.run("--source", f.sourceRoot);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal((await f.load()).operators.length, 104);
});

test("missing tag translations fail before replacing a valid snapshot", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("--source", f.sourceRoot).status, 0);
  const before = await readFile(path.join(f.root, snapshotPath), "utf8");
  await f.json(path.join(f.sourceRoot, "assets/locales/us/tag.json"), {});
  for (const extra of [[], ["--allow-removals"]]) {
    const failed = f.run("--source", f.sourceRoot, ...extra);
    assert.notEqual(failed.status, 0);
    assert.equal(await readFile(path.join(f.root, snapshotPath), "utf8"), before);
  }
});
