import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const PORTRAITS_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("full operator fixture covers the generated operator catalog", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const [catalog, fullFixture] = await Promise.all([
    readFile(path.join(projectRoot, "src/generated/arkntools/operator-catalog.json"), "utf8").then(JSON.parse),
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
    const catalog = JSON.parse(await readFile(path.join(options.outputRoot, "src/generated/arkntools/operator-catalog.json"), "utf8"));
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
  const catalog = JSON.parse(await readFile(path.join(options.outputRoot, "src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.ok(catalog[0].portrait.endsWith(SOURCE_SHA.slice(0, 12)));
  assert.ok(catalog[1].portrait.endsWith(PORTRAITS_SHA.slice(0, 12)));
  const manifestPath = path.join(options.outputRoot, "src/generated/arkntools/source.json");
  manifest.portraitsFallback.operators.push("char_999_unknown");
  await writeFile(manifestPath, JSON.stringify(manifest));
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
  const operators = JSON.parse(await readFile(path.join(first, "src/generated/arkntools/operator-catalog.json"), "utf8"));
  assert.equal(operators[0].portrait, `/images/operator-portraits/001_alpha.webp?v=${GENERATED_VERSION}-${PORTRAITS_SHA.slice(0, 12)}`);
  assert.equal(operators[0].order, 0);
  assert.equal(operators[1].order, 1);
  assert.deepEqual(operators[0].buildingSkills[0], { index: 1, id: "skill_alpha", elite: 0, level: 1 });
  assert.deepEqual(operators[1].buildingSkills[0], { index: 1, id: "skill_beta", elite: 2, level: 1 });

  const skills = JSON.parse(await readFile(path.join(first, "src/generated/arkntools/building-skill-catalog.json"), "utf8"));
  assert.equal(skills.skill_alpha.descriptionRich, "进驻时，生产力<@cc.vup>+10%</>。");
  assert.equal("description" in skills.skill_alpha, false);
  assert.equal("room" in skills.skill_alpha, false);
  assert.equal("roomLabel" in skills.skill_alpha, false);
  assert.deepEqual(skills.skill_alpha.tags, ["贵金属"]);
  assert.deepEqual(skills.skill_beta.tags, ["单体恢复", "自身恢复"]);

  const terms = JSON.parse(await readFile(path.join(first, "src/generated/arkntools/term-catalog.json"), "utf8"));
  assert.deepEqual(terms.cc_test, { id: "cc_test", name: "测试词条", desc: "<$cc.x><@cc.rem>红松骑士团</></>", descText: "红松骑士团" });

  const relativeFiles = [
    "src/generated/arkntools/operator-catalog.json",
    "src/generated/arkntools/operator-pinyin.json",
    "src/generated/arkntools/building-skill-catalog.json",
    "src/generated/arkntools/term-catalog.json",
    "src/generated/arkntools/source.json",
    "public/images/building-skills/icon_shared.png",
    "public/images/operator-portraits/001_alpha.webp",
    "public/images/products/lmd_orders.webp",
    "public/images/products/gold.webp",
    "public/images/products/experience.webp",
    "public/images/products/originium_shard.webp",
    "public/images/products/orundum.webp",
    "public/images/products/drone.webp",
  ];
  for (const relative of relativeFiles) {
    assert.deepEqual(await readFile(path.join(first, relative)), await readFile(path.join(second, relative)));
  }
  const normalized = await sharp(await readFile(path.join(first, "public/images/building-skills/icon_shared.png"))).metadata();
  assert.deepEqual([normalized.width, normalized.height], [36, 36]);
  const portrait = await sharp(await readFile(path.join(first, "public/images/operator-portraits/001_alpha.webp"))).metadata();
  assert.deepEqual([portrait.width, portrait.height], [180, 180]);
  assert.equal(portrait.format, "webp");
  for (const name of ["lmd_orders", "gold", "experience", "originium_shard", "orundum", "drone"]) {
    const product = await sharp(await readFile(path.join(first, `public/images/products/${name}.webp`))).metadata();
    assert.deepEqual([product.format, product.width, product.height, product.hasAlpha], ["webp", 183, 183, true]);
  }
  const [webpSize, pngSize] = await Promise.all([
    stat(path.join(first, "public/images/operator-portraits/001_alpha.webp")),
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
  const after = await alphaBounds(path.join(output, "public/images/operator-portraits/001_alpha.webp"));

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
