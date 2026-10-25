import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import process from "node:process";

import sharp from "sharp";

import {
  ARKNIGHTS_GAME_RESOURCE_REPOSITORY,
  ARKNTOOLS_REPOSITORY,
  GENERATED_VERSION,
  checkGeneratedAssets,
  generateAssets,
  generateFullOperatorFixture,
  operatorSupplementalTags,
  parseUnlock,
  stripGameMarkup,
  supplementalSkillTags,
} from "./arkntools-assets-lib.mjs";
import { detectManagedChanges, hasManagedContentChange } from "./arkntools-sync-changes.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const PORTRAITS_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("full operator fixture covers the generated operator catalog", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const [catalog, fullFixture] = await Promise.all([
    readFile(path.join(projectRoot, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(projectRoot, "fixtures/operbox_full_e2.json"), "utf8").then(JSON.parse),
  ]);
  const fixtureIds = new Set(fullFixture.map((operator) => operator.id));
  assert.equal(fullFixture.length, catalog.length);
  assert.deepEqual(catalog.filter((operator) => !fixtureIds.has(operator.id)).map((operator) => operator.id), []);
});

test("full operator fixture uses attainable maximum levels for every rarity", () => {
  const fixture = generateFullOperatorFixture([1, 2, 3, 4, 5, 6].map((rarity) => ({ id: String(rarity), name: String(rarity), rarity })));
  assert.deepEqual(fixture.map(({ elite, level }) => [elite, level]), [[0, 30], [0, 30], [1, 55], [2, 70], [2, 80], [2, 90]]);
  assert.ok(fixture.every(({ own, potential }) => own && potential === 6));
});

test("skips only alternate Amiya forms with or without building records, retaining base Amiya", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  await createSource(source, ["002_amiya"]);
  const characterPath = path.join(source, "assets/data/character.json");
  const localePath = path.join(source, "assets/locales/cn/character.json");
  const buildingPath = path.join(source, "assets/data/building.json");
  const characters = JSON.parse(await readFile(characterPath, "utf8"));
  const locale = JSON.parse(await readFile(localePath, "utf8"));
  const building = JSON.parse(await readFile(buildingPath, "utf8"));
  for (const id of ["1001_amiya2", "1037_amiya3"]) {
    characters[id] = characters["002_amiya"];
    locale[id] = locale["002_amiya"];
  }
  await writeFile(characterPath, JSON.stringify(characters));
  await writeFile(localePath, JSON.stringify(locale));
  const options = { sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: path.join(root, "output") };
  for (const includeBuildingRecords of [false, true]) {
    if (includeBuildingRecords) {
      for (const id of ["1001_amiya2", "1037_amiya3"]) building.char[id] = building.char["002_amiya"];
      await writeFile(buildingPath, JSON.stringify(building));
    }
    await generateAssets(options);
    const catalog = JSON.parse(await readFile(path.join(options.outputRoot, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8"));
    assert.deepEqual(catalog.map(({ id }) => id), ["char_002_amiya"]);
  }
  characters["999_unexpected"] = characters["002_amiya"];
  locale["999_unexpected"] = "Unexpected missing building record";
  await writeFile(characterPath, JSON.stringify(characters));
  await writeFile(localePath, JSON.stringify(locale));
  await assert.rejects(generateAssets(options), /干员集合不一致/);
});

test("missing primary portraits use pinned toolbox assets, while corrupt primary files still fail", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  await createSource(source);
  const primary = path.join(source, "portraits/avatar/char_001_alpha.png");
  await unlink(primary);
  await mkdir(path.join(source, "assets/img/avatar"), { recursive: true });
  await png(path.join(source, "assets/img/avatar/001_alpha.png"), 180, 180, { r: 30, g: 50, b: 70, alpha: 1 });
  const options = { sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: path.join(root, "output") };
  const { manifest } = await generateAssets(options);
  assert.deepEqual(manifest.portraitsFallback, { repository: ARKNTOOLS_REPOSITORY, commit: SOURCE_SHA, directory: "assets/img/avatar", operators: ["char_001_alpha"] });
  const catalog = JSON.parse(await readFile(path.join(options.outputRoot, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.equal(catalog[0].portrait, await contentPortraitPath(options.outputRoot, "001_alpha"));
  assert.equal(catalog[1].portrait, await contentPortraitPath(options.outputRoot, "002_beta"));
  const next = { ...options, sourceSha: "b".repeat(40), portraitsSha: "c".repeat(40) };
  await generateAssets(next);
  const nextCatalog = JSON.parse(await readFile(path.join(options.outputRoot, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.deepEqual(nextCatalog, catalog, "Fallback and primary portrait URLs do not depend on upstream commits");
  await png(path.join(source, "assets/img/avatar/001_alpha.png"), 180, 180, { r: 230, g: 10, b: 20, alpha: 1 });
  await generateAssets(next);
  const changedCatalog = JSON.parse(await readFile(path.join(options.outputRoot, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.notEqual(changedCatalog[0].portrait, catalog[0].portrait);
  assert.equal(changedCatalog[1].portrait, catalog[1].portrait);
  const manifestPath = path.join(options.outputRoot, "packages/arknights-domain/src/generated/arkntools/source.json");
  const currentManifest = await checkGeneratedAssets(options.outputRoot);
  currentManifest.portraitsFallback.operators.push("char_999_unknown");
  await writeFile(manifestPath, JSON.stringify(currentManifest));
  await assert.rejects(checkGeneratedAssets(options.outputRoot), /备用头像来源包含未知干员/);
  await writeFile(primary, "corrupt PNG");
  await assert.rejects(generateAssets(options), /PNG|image format/);
});

async function makeTemp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "arkntools-assets-test-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

async function png(filePath, width, height, color) {
  await sharp({ create: { width, height, channels: 4, background: color } }).png().toFile(filePath);
}

async function contentPortraitPath(root, shortId) {
  const bytes = await readFile(path.join(root, `apps/arknights/public/images/operator-portraits/${shortId}.webp`));
  return `/images/operator-portraits/${shortId}.webp?v=sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

async function boundedPng(filePath, width, height, { left, top, right, bottom }) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 190;
      pixels[offset + 1] = 110;
      pixels[offset + 2] = 45;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

async function alphaBounds(filePath) {
  const { data, info } = await sharp(await readFile(filePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaChannel = info.channels - 1;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaChannel] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      visiblePixels += 1;
    }
  }
  return { width: info.width, height: info.height, left, top, right, bottom, visiblePixels };
}

async function createSource(root, operatorIds = ["001_alpha", "002_beta"]) {
  const directories = [
    "assets/data",
    "assets/locales/cn",
    "assets/img/building_skill",
    "assets/img/item",
  ];
  // 干员头像来自独立的 ArknightsGameResource 风格来源目录（avatar/char_<shortId>.png，180×180）
  const portraitsRoot = path.join(root, "portraits");
  await Promise.all([
    ...directories.map((directory) => mkdir(path.join(root, directory), { recursive: true })),
    mkdir(path.join(portraitsRoot, "avatar"), { recursive: true }),
    mkdir(path.join(portraitsRoot, "item"), { recursive: true }),
  ]);

  const characters = Object.fromEntries(operatorIds.map((id, index) => [id, {
    star: index === 0 ? 6 : 5,
    profession: index + 1,
    position: 10,
  }]));
  const names = Object.fromEntries(operatorIds.map((id, index) => [id, index === 0 ? "测试甲" : "测试乙"]));
  const charSkills = Object.fromEntries(operatorIds.map((id, index) => [id, [{
    id: index === 0 ? "skill_alpha" : "skill_beta",
    unlock: index === 0 ? "0_1" : "2_1",
  }]]));
  const buffData = {
    skill_alpha: { icon: "icon_shared", desc: "desc_alpha" },
    ...(operatorIds.length > 1 ? { skill_beta: { icon: "icon_beta", desc: "desc_beta" } } : {}),
  };
  const buffNames = {
    skill_alpha: "技能甲",
    ...(operatorIds.length > 1 ? { skill_beta: "技能乙" } : {}),
  };
  const descriptions = {
    desc_alpha: "进驻时，生产力<@cc.vup>+10%</>。",
    ...(operatorIds.length > 1 ? { desc_beta: "自身心情每小时恢复<@cc.vup>+0.5</>。" } : {}),
  };
  const buffInfo = {
    desc_alpha: { building: "MANUFACTURE", num: { product: 10 }, is: { "贵金属": 1 } },
    ...(operatorIds.length > 1 ? { desc_beta: { building: "DORMITORY", num: {}, is: { "单体恢复": 1 } } } : {}),
  };
  const roomNames = {
    CONTROL: "控制中枢",
    POWER: "发电站",
    MANUFACTURE: "制造站",
    TRADING: "贸易站",
    DORMITORY: "宿舍",
    MEETING: "会客室",
    WORKSHOP: "加工站",
    TRAINING: "训练室",
    HIRE: "办公室",
  };
  const terms = {
    cc_test: { name: "测试词条", desc: "<$cc.x><@cc.rem>红松骑士团</></>" },
  };

  await Promise.all([
    writeFile(path.join(root, "assets/data/character.json"), JSON.stringify(characters), "utf8"),
    writeFile(path.join(root, "assets/locales/cn/character.json"), JSON.stringify(names), "utf8"),
    writeFile(path.join(root, "assets/data/building.json"), JSON.stringify({ char: charSkills, buff: { data: buffData, info: buffInfo } }), "utf8"),
    writeFile(path.join(root, "assets/locales/cn/building.json"), JSON.stringify({ name: roomNames, buff: { name: buffNames, description: descriptions } }), "utf8"),
    writeFile(path.join(root, "assets/locales/cn/term.json"), JSON.stringify(terms), "utf8"),
    ...operatorIds.map((id, index) => png(path.join(portraitsRoot, `avatar/char_${id}.png`), 180, 180, { r: index * 40, g: 20, b: 30, alpha: 1 })),
    png(path.join(root, "assets/img/building_skill/icon_shared.png"), 35, 36, { r: 10, g: 20, b: 30, alpha: 1 }),
    ...(operatorIds.length > 1
      ? [png(path.join(root, "assets/img/building_skill/icon_beta.png"), 36, 36, { r: 30, g: 20, b: 10, alpha: 1 })]
      : []),
    png(path.join(root, "assets/img/item/4001.png"), 183, 183, { r: 220, g: 180, b: 25, alpha: 0.7 }),
    png(path.join(portraitsRoot, "item/AP_BASE.png"), 183, 183, { r: 160, g: 90, b: 200, alpha: 0.7 }),
    png(path.join(root, "assets/img/item/2003.png"), 183, 183, { r: 50, g: 160, b: 190, alpha: 0.7 }),
    png(path.join(portraitsRoot, "item/MTL_GOLD3.png"), 183, 183, { r: 190, g: 150, b: 20, alpha: 0.7 }),
    png(path.join(portraitsRoot, "item/MTL_DIAMOND_SHD.png"), 183, 183, { r: 80, g: 70, b: 90, alpha: 0.7 }),
    png(path.join(portraitsRoot, "item/DIAMOND_SHD.png"), 183, 183, { r: 210, g: 45, b: 55, alpha: 0.7 }),
  ]);
}

test("strips game markup and parses unlock requirements", () => {
  assert.equal(stripGameMarkup("进驻<$cc.test><@cc.kw>制造站</></> &amp; 生效"), "进驻制造站 & 生效");
  assert.deepEqual(parseUnlock("2_30"), { elite: 2, level: 30 });
  assert.throws(() => parseUnlock("3_1"), /非法精英阶段/);
  assert.throws(() => parseUnlock("bad"), /无法解析/);
});

test("supplements skill tags by room rules and operator names", () => {
  assert.deepEqual(supplementalSkillTags("CONTROL", "人脉资源的联络速度+10%"), ["办公室"]);
  assert.deepEqual(supplementalSkillTags("HIRE", "人脉资源的联络速度+10%"), ["联络速度"]);
  assert.deepEqual(supplementalSkillTags("MEETING", "更容易获得线索板上尚未拥有的线索"), ["未拥有加成"]);
  assert.deepEqual(supplementalSkillTags("DORMITORY", "自身心情每小时恢复+0.5"), ["自身恢复"]);
  assert.deepEqual(supplementalSkillTags("DORMITORY", "恢复效果额外+10%"), ["特殊恢复"]);
  assert.deepEqual(supplementalSkillTags("HIRE", "不包含初始招募位"), ["特殊加成"]);
  assert.deepEqual(supplementalSkillTags("TRAINING", "该名干员下次训练所需时间-50%（任意一方离开训练室时，效果消失）"), ["减半"]);
  assert.deepEqual(supplementalSkillTags("TRADING", "如果下笔赤金订单是违约订单，则赤金交付数额外+1"), ["特殊订单"]);
  assert.deepEqual(supplementalSkillTags("MANUFACTURE", "生产力+10%"), []);
  assert.deepEqual(operatorSupplementalTags("九色鹿"), ["精英材料"]);
  assert.deepEqual(operatorSupplementalTags("阿米娅"), []);
});

test("generates deterministic catalogs and normalizes the known 35px icon input", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  await createSource(source);
  const portraitsSource = path.join(source, "portraits");

  await generateAssets({ sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: portraitsSource, portraitsSha: PORTRAITS_SHA, outputRoot: first, allowRemovals: true });
  await generateAssets({ sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: portraitsSource, portraitsSha: PORTRAITS_SHA, outputRoot: second, allowRemovals: true });
  const manifest = await checkGeneratedAssets(first);
  assert.deepEqual(manifest.counts, { operators: 2, buildingSkills: 2, terms: 1, portraits: 2, buildingSkillIcons: 2, productIcons: 6 });
  assert.equal(manifest.portraitsSource.repository, ARKNIGHTS_GAME_RESOURCE_REPOSITORY);
  assert.equal(manifest.portraitsSource.commit, PORTRAITS_SHA);
  assert.deepEqual(manifest.products.map((product) => [product.id, product.source]), [
    ["lmd_orders", "arkntools"],
    ["gold", "game-resource"],
    ["experience", "arkntools"],
    ["originium_shard", "game-resource"],
    ["orundum", "game-resource"],
    ["drone", "game-resource"],
  ]);
  assert.equal(manifest.source.repository, ARKNTOOLS_REPOSITORY);
  const operators = JSON.parse(await readFile(path.join(first, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.equal(manifest.portraitVersioning, "sha256");
  assert.equal(operators[0].portrait, await contentPortraitPath(first, "001_alpha"));
  assert.equal(operators[0].order, 0);
  assert.equal(operators[1].order, 1);
  assert.deepEqual(operators[0].buildingSkills[0], { index: 1, id: "skill_alpha", elite: 0, level: 1 });
  assert.deepEqual(operators[1].buildingSkills[0], { index: 1, id: "skill_beta", elite: 2, level: 1 });

  const skills = JSON.parse(await readFile(path.join(first, "packages/arknights-domain/src/generated/arkntools/building-skill-catalog.json"), "utf8"));
  assert.equal(skills.skill_alpha.descriptionRich, "进驻时，生产力<@cc.vup>+10%</>。");
  assert.equal("description" in skills.skill_alpha, false);
  assert.equal("room" in skills.skill_alpha, false);
  assert.equal("roomLabel" in skills.skill_alpha, false);
  assert.deepEqual(skills.skill_alpha.tags, ["贵金属"]);
  assert.deepEqual(skills.skill_beta.tags, ["单体恢复", "自身恢复"]);

  const terms = JSON.parse(await readFile(path.join(first, "packages/arknights-domain/src/generated/arkntools/term-catalog.json"), "utf8"));
  assert.deepEqual(terms.cc_test, { id: "cc_test", name: "测试词条", desc: "<$cc.x><@cc.rem>红松骑士团</></>", descText: "红松骑士团" });

  const relativeFiles = [
    "packages/arknights-domain/src/generated/arkntools/operator-catalog.json",
    "packages/arknights-domain/src/generated/arkntools/operator-pinyin.json",
    "packages/arknights-domain/src/generated/arkntools/building-skill-catalog.json",
    "packages/arknights-domain/src/generated/arkntools/term-catalog.json",
    "packages/arknights-domain/src/generated/arkntools/source.json",
    "apps/arknights/public/images/building-skills/icon_shared.png",
    "apps/arknights/public/images/operator-portraits/001_alpha.webp",
    "apps/arknights/public/images/products/lmd_orders.webp",
    "apps/arknights/public/images/products/gold.webp",
    "apps/arknights/public/images/products/experience.webp",
    "apps/arknights/public/images/products/originium_shard.webp",
    "apps/arknights/public/images/products/orundum.webp",
    "apps/arknights/public/images/products/drone.webp",
  ];
  for (const relative of relativeFiles) {
    assert.deepEqual(await readFile(path.join(first, relative)), await readFile(path.join(second, relative)));
  }
  const normalized = await sharp(await readFile(path.join(first, "apps/arknights/public/images/building-skills/icon_shared.png"))).metadata();
  assert.deepEqual([normalized.width, normalized.height], [36, 36]);
  const portrait = await sharp(await readFile(path.join(first, "apps/arknights/public/images/operator-portraits/001_alpha.webp"))).metadata();
  assert.deepEqual([portrait.width, portrait.height], [180, 180]);
  assert.equal(portrait.format, "webp");
  for (const name of ["lmd_orders", "gold", "experience", "originium_shard", "orundum", "drone"]) {
    const product = await sharp(await readFile(path.join(first, `apps/arknights/public/images/products/${name}.webp`))).metadata();
    assert.deepEqual([product.format, product.width, product.height, product.hasAlpha], ["webp", 183, 183, true]);
  }
  const [webpSize, pngSize] = await Promise.all([
    stat(path.join(first, "apps/arknights/public/images/operator-portraits/001_alpha.webp")),
    stat(path.join(source, "portraits/avatar/char_001_alpha.png")),
  ]);
  assert.ok(webpSize.size < pngSize.size, "WebP 头像应比源 PNG 更小。");
});

test("centers asymmetric visible portrait pixels without scaling or cropping", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await createSource(source, ["001_alpha"]);
  const portraitSource = path.join(source, "portraits/avatar/char_001_alpha.png");
  await boundedPng(portraitSource, 180, 180, { left: 5, top: 30, right: 143, bottom: 166 });
  const before = await alphaBounds(portraitSource);

  await generateAssets({ sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: output, allowRemovals: true });
  const after = await alphaBounds(path.join(output, "apps/arknights/public/images/operator-portraits/001_alpha.webp"));

  assert.deepEqual([after.width, after.height], [180, 180]);
  assert.deepEqual([after.right - after.left, after.bottom - after.top], [before.right - before.left, before.bottom - before.top]);
  assert.equal(after.visiblePixels, before.visiblePixels);
  assert.ok(Math.abs(after.left - (after.width - after.right - 1)) <= 1, "水平透明边距应居中。");
  assert.ok(Math.abs(after.top - (after.height - after.bottom - 1)) <= 1, "垂直透明边距应居中。");
});

test("rejects fully transparent portraits before installing output", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  await createSource(source, ["001_alpha"]);
  await png(path.join(source, "portraits/avatar/char_001_alpha.png"), 180, 180, { r: 0, g: 0, b: 0, alpha: 0 });

  await assert.rejects(
    generateAssets({ sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: path.join(root, "output"), allowRemovals: true }),
    /不得是全透明图片/
  );
});

test("rejects duplicate names and missing referenced images before installing output", async (t) => {
  const root = await makeTemp(t);
  const duplicateSource = path.join(root, "duplicate");
  const missingImageSource = path.join(root, "missing-image");
  await createSource(duplicateSource);
  await createSource(missingImageSource);

  const duplicateLocalePath = path.join(duplicateSource, "assets/locales/cn/character.json");
  await writeFile(duplicateLocalePath, JSON.stringify({ "001_alpha": "重名", "002_beta": "重名" }), "utf8");
  await assert.rejects(
    generateAssets({ sourceRoot: duplicateSource, sourceSha: SOURCE_SHA, portraitsRoot: path.join(duplicateSource, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: path.join(root, "duplicate-output"), allowRemovals: true }),
    /干员名称重复/
  );

  await unlink(path.join(missingImageSource, "assets/img/building_skill/icon_beta.png"));
  await assert.rejects(
    generateAssets({ sourceRoot: missingImageSource, sourceSha: SOURCE_SHA, portraitsRoot: path.join(missingImageSource, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: path.join(root, "missing-output"), allowRemovals: true }),
    /ENOENT/
  );
});

test("blocks managed file removals unless explicitly confirmed", async (t) => {
  const root = await makeTemp(t);
  const fullSource = path.join(root, "full-source");
  const reducedSource = path.join(root, "reduced-source");
  const output = path.join(root, "output");
  await createSource(fullSource);
  await createSource(reducedSource, ["001_alpha"]);
  await generateAssets({ sourceRoot: fullSource, sourceSha: SOURCE_SHA, portraitsRoot: path.join(fullSource, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: output, allowRemovals: true });

  await assert.rejects(
    generateAssets({ sourceRoot: reducedSource, sourceSha: SOURCE_SHA, portraitsRoot: path.join(reducedSource, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: output }),
    /上游干员数量从 2 降至 1/
  );
  assert.equal((await checkGeneratedAssets(output)).counts.operators, 2);
});

test("upstream-only updates skip publication and changing one portrait only invalidates its own URL", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await createSource(source);
  const options = { sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: output };
  await generateAssets(options);
  const catalogFile = path.join(output, "packages/arknights-domain/src/generated/arkntools/operator-catalog.json");
  const originalCatalog = JSON.parse(await readFile(catalogFile, "utf8"));
  const git = (...args) => execFileSync("git", args, { cwd: output, stdio: "pipe" });
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=Resource test", "-c", "user.email=resource@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "baseline");
  assert.deepEqual(await detectManagedChanges(output), { changed: false, contentFiles: [], provenanceOnlyFiles: [] });

  await generateAssets({ ...options, sourceSha: "b".repeat(40), portraitsSha: "c".repeat(40) });
  assert.deepEqual(JSON.parse(await readFile(catalogFile, "utf8")), originalCatalog);
  assert.deepEqual(await detectManagedChanges(output), {
    changed: false, contentFiles: [], provenanceOnlyFiles: ["packages/arknights-domain/src/generated/arkntools/source.json"],
  });

  const ghOutput = path.join(root, "github-output");
  const ghSummary = path.join(root, "github-summary");
  execFileSync(process.execPath, [path.join(import.meta.dirname, "arkntools-sync-changes.mjs")], {
    cwd: output, env: { ...process.env, GITHUB_OUTPUT: ghOutput, GITHUB_STEP_SUMMARY: ghSummary }, stdio: "pipe",
  });
  assert.equal(await readFile(ghOutput, "utf8"), "changed=false\n");
  assert.match(await readFile(ghSummary, "utf8"), /do not create a resource PR or deployment/);

  await png(path.join(source, "portraits/avatar/char_001_alpha.png"), 180, 180, { r: 240, g: 20, b: 30, alpha: 1 });
  await generateAssets(options);
  const changedCatalog = JSON.parse(await readFile(catalogFile, "utf8"));
  assert.notEqual(changedCatalog[0].portrait, originalCatalog[0].portrait);
  assert.deepEqual(changedCatalog[1], originalCatalog[1]);
  assert.deepEqual((await detectManagedChanges(output)).contentFiles, [
    "apps/arknights/public/images/operator-portraits/001_alpha.webp",
    "packages/arknights-domain/src/generated/arkntools/operator-catalog.json",
  ]);
  // Valid image bytes with a stale URL must also fail the asset gate.
  changedCatalog[0].portrait = originalCatalog[0].portrait;
  await writeFile(catalogFile, JSON.stringify(changedCatalog));
  await assert.rejects(checkGeneratedAssets(output), /头像内容哈希与路径不一致/);
});

test("legacy portrait catalogs remain valid until a generated content-hash migration", async (t) => {
  const root = await makeTemp(t);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await createSource(source);
  await generateAssets({ sourceRoot: source, sourceSha: SOURCE_SHA, portraitsRoot: path.join(source, "portraits"), portraitsSha: PORTRAITS_SHA, outputRoot: output });
  const dataRoot = path.join(output, "packages/arknights-domain/src/generated/arkntools");
  const manifest = JSON.parse(await readFile(path.join(dataRoot, "source.json"), "utf8"));
  const catalog = JSON.parse(await readFile(path.join(dataRoot, "operator-catalog.json"), "utf8"));
  delete manifest.portraitVersioning;
  for (const operator of catalog) operator.portrait = `/images/operator-portraits/${operator.id.slice(5)}.webp?v=${GENERATED_VERSION}-${PORTRAITS_SHA.slice(0, 12)}`;
  await writeFile(path.join(dataRoot, "source.json"), JSON.stringify(manifest));
  await writeFile(path.join(dataRoot, "operator-catalog.json"), JSON.stringify(catalog));
  await checkGeneratedAssets(output);
  manifest.portraitVersioning = "unknown";
  await writeFile(path.join(dataRoot, "source.json"), JSON.stringify(manifest));
  await assert.rejects(checkGeneratedAssets(output), /头像缓存版本策略无效/);
});

test("publication ignores only pinned provenance commits, not schema, source or mastery changes", () => {
  const manifestFile = "packages/arknights-domain/src/generated/arkntools/source.json";
  const masteryFile = "apps/arknights/src/generated/mastery-data.json";
  const manifest = {
    version: 2, source: { repository: ARKNTOOLS_REPOSITORY, commit: SOURCE_SHA },
    portraitsSource: { repository: ARKNIGHTS_GAME_RESOURCE_REPOSITORY, commit: PORTRAITS_SHA },
    portraitsFallback: { repository: ARKNTOOLS_REPOSITORY, commit: SOURCE_SHA, operators: ["char_001_alpha"] },
    counts: { operators: 2 },
  };
  const mastery = { source: { rules: manifest.source, branches: manifest.portraitsSource, descriptionsHash: "reviewed" }, branches: { char_001_alpha: "fighter" }, rules: { train: { speed: 0.3 } } };
  const changed = (file, before, after) => hasManagedContentChange(file, JSON.stringify(before), JSON.stringify(after));
  const nextManifest = globalThis.structuredClone(manifest);
  for (const source of [nextManifest.source, nextManifest.portraitsSource, nextManifest.portraitsFallback]) source.commit = "d".repeat(40);
  assert.equal(changed(manifestFile, manifest, nextManifest), false);
  const nextMastery = globalThis.structuredClone(mastery);
  nextMastery.source.rules.commit = "e".repeat(40);
  nextMastery.source.branches.commit = "f".repeat(40);
  assert.equal(changed(masteryFile, mastery, nextMastery), false);
  for (const mutate of [
    (data) => { data.source.repository = "https://example.test/changed-source"; },
    (data) => { data.counts.operators = 1; },
    (data) => { data.portraitsFallback.operators = ["char_002_beta"]; },
    (data) => { data.portraitVersioning = "sha256"; },
    (data) => { data.source.commit = "invalid"; },
    (data) => { data.source.commit = "<upstream-commit>"; },
    (data) => { delete data.source.commit; },
  ]) {
    const data = globalThis.structuredClone(nextManifest);
    mutate(data);
    assert.equal(changed(manifestFile, manifest, data), true);
  }
  for (const mutate of [
    (data) => { data.source.descriptionsHash = "changed"; },
    (data) => { data.branches.char_001_alpha = "caster"; },
    (data) => { data.rules.train.speed = 0.4; },
  ]) {
    const data = globalThis.structuredClone(nextMastery);
    mutate(data);
    assert.equal(changed(masteryFile, mastery, data), true);
  }
  assert.throws(() => hasManagedContentChange(manifestFile, JSON.stringify(manifest), "broken JSON"));
  assert.equal(hasManagedContentChange(manifestFile, null, JSON.stringify(manifest)), true);
  assert.equal(hasManagedContentChange(manifestFile, JSON.stringify(manifest), null), true);
  assert.equal(changed("packages/arknights-domain/src/generated/gacha-up.json", { pool: 1 }, { pool: 2 }), true);
});

test("publication detects staged, untracked and deleted managed files without modifying the index", async (t) => {
  const root = await makeTemp(t);
  const catalogRoot = path.join(root, "packages/arknights-domain/src/generated/arkntools");
  await mkdir(catalogRoot, { recursive: true });
  const sourceFile = path.join(catalogRoot, "source.json");
  const source = { source: { commit: SOURCE_SHA } };
  await writeFile(sourceFile, JSON.stringify(source));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=Resource test", "-c", "user.email=resource@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "baseline");
  source.source.commit = PORTRAITS_SHA;
  await writeFile(sourceFile, JSON.stringify(source));
  git("add", ".");
  const indexBefore = git("diff", "--cached");
  assert.equal((await detectManagedChanges(root)).changed, false);
  assert.equal(git("diff", "--cached"), indexBefore);

  const poolFile = path.join(root, "packages/arknights-domain/src/generated/gacha-up.json");
  await writeFile(poolFile, JSON.stringify({ newPool: { six: ["测试甲"] } }));
  assert.deepEqual((await detectManagedChanges(root)).contentFiles, ["packages/arknights-domain/src/generated/gacha-up.json"]);
  git("add", ".");
  assert.equal((await detectManagedChanges(root)).changed, true);
  await unlink(sourceFile);
  assert.ok((await detectManagedChanges(root)).contentFiles.includes("packages/arknights-domain/src/generated/arkntools/source.json"));
});
