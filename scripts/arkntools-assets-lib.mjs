import { Buffer } from "node:buffer";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile, copyFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import path from "node:path";

import sharp from "sharp";
import { pinyin } from "pinyin-pro";

export function generateOperatorPinyin(operators) {
  return Object.fromEntries(operators.map(({ name }) => [name, [
    pinyin(name, { pattern: "first", toneType: "none", type: "array" }).join("").toLowerCase(),
    pinyin(name, { toneType: "none", type: "array" }).join("").toLowerCase(),
  ]]));
}

export const ARKNTOOLS_REPOSITORY = "https://github.com/arkntools/arknights-toolbox-data";
export const ARKNIGHTS_GAME_RESOURCE_REPOSITORY = "https://github.com/yuanyan3060/ArknightsGameResource";
export const GENERATED_VERSION = 2;

// Alternate Amiya forms share the base operator's infrastructure identity.
const EXCLUDED_OPERATOR_IDS = new Set(["1001_amiya2", "1037_amiya3"]);
const withoutAlternateAmiya = (entries) => Object.fromEntries(
  Object.entries(entries).filter(([id]) => !EXCLUDED_OPERATOR_IDS.has(id)),
);

export function generateFullOperatorFixture(operators) {
  return [...operators].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(({ id, name, rarity }) => ({
    id, name, elite: rarity >= 4 ? 2 : rarity === 3 ? 1 : 0,
    level: rarity === 6 ? 90 : rarity === 5 ? 80 : rarity === 4 ? 70 : rarity === 3 ? 55 : 30,
    own: true, potential: 6, rarity,
  }));
}

const MANAGED_PATHS = [
  "public/images/operator-portraits",
  "public/images/building-skills",
  "public/images/products",
  "src/generated/arkntools",
  "fixtures/operbox_full_e2.json",
];

// 优先使用 ArknightsGameResource 的 avatar/char_<shortId>.png；
// 尚未收录的头像使用同次固定版本的 arkntools assets/img/avatar，并单独记录来源。
// 按上游原尺寸使用：透明内容在画布内居中后有损转成 WebP（透明背景保留，q85 + 智能色度抽样避免边缘色晕）。
const PORTRAITS_DIRECTORY = "avatar";
const WEBP_PORTRAIT_OPTIONS = { quality: 85, effort: 6, smartSubsample: true };
const WEBP_PRODUCT_OPTIONS = { quality: 85, effort: 6, smartSubsample: true };

const SOURCE_PATHS = {
  characterData: "assets/data/character.json",
  buildingData: "assets/data/building.json",
  characterLocale: "assets/locales/cn/character.json",
  buildingLocale: "assets/locales/cn/building.json",
  termLocale: "assets/locales/cn/term.json",
  buildingSkills: "assets/img/building_skill",
};

const PRODUCT_ASSETS = [
  { id: "lmd_orders", source: "arkntools", path: "assets/img/item/4001.png" },
  { id: "gold", source: "game-resource", path: "item/MTL_GOLD3.png" },
  { id: "experience", source: "arkntools", path: "assets/img/item/2003.png" },
  { id: "originium_shard", source: "game-resource", path: "item/MTL_DIAMOND_SHD.png" },
  { id: "orundum", source: "game-resource", path: "item/DIAMOND_SHD.png" },
  { id: "drone", source: "game-resource", path: "item/AP_BASE.png" },
];

const SAFE_ASSET_NAME = /^[A-Za-z0-9_&]+$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} 超出受管目录。`);
}

async function readJson(filePath, label) {
  const stat = await lstat(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} 必须是普通文件。`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right, "en")));
}

function sameKeys(left, right, leftLabel, rightLabel) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  assert(
    leftKeys.length === rightKeys.length && leftKeys.every((value, index) => value === rightKeys[index]),
    `${leftLabel} 与 ${rightLabel} 的干员集合不一致。`
  );
}

export function stripGameMarkup(value) {
  assert(typeof value === "string", "基建技能描述必须是字符串。");
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 在工具箱 buff.info.is 标签之外补充的前端标签规则（按房间 + 描述关键词）。
const SUPPLEMENTAL_TAG_RULES = {
  CONTROL: [{ tag: "办公室", keyword: "联络速度" }],
  MEETING: [{ tag: "未拥有加成", keyword: "尚未拥有的线索" }],
  DORMITORY: [
    { tag: "自身恢复", keyword: "自身心情每小时恢复" },
    { tag: "特殊恢复", keyword: "恢复效果额外" },
  ],
  HIRE: [
    { tag: "联络速度", keyword: "联络速度" },
    { tag: "特殊加成", keyword: "不包含初始招募位" },
  ],
  TRAINING: [{ tag: "减半", keyword: "所需时间-50%" }],
  TRADING: [{ tag: "特殊订单", keyword: "违约订单" }],
};

const OPERATOR_SUPPLEMENTAL_TAGS = {
  九色鹿: ["精英材料"],
};

/** 按房间 + 纯文本描述关键词计算补充标签。 */
export function supplementalSkillTags(room, description) {
  if (!room) return [];
  return (SUPPLEMENTAL_TAG_RULES[room] ?? [])
    .filter(({ keyword }) => description.includes(keyword))
    .map(({ tag }) => tag);
}

/** 按干员名追加的补充标签（如九色鹿的加工站技能标为精英材料）。 */
export function operatorSupplementalTags(name) {
  return OPERATOR_SUPPLEMENTAL_TAGS[name] ?? [];
}

export function parseUnlock(value) {
  assert(typeof value === "string", "基建技能解锁条件必须是字符串。");
  const match = /^(\d+)_(\d+)$/.exec(value);
  assert(match, `无法解析基建技能解锁条件：${value}`);
  const elite = Number(match[1]);
  const level = Number(match[2]);
  assert(Number.isInteger(elite) && elite >= 0 && elite <= 2, `非法精英阶段：${value}`);
  assert(Number.isInteger(level) && level >= 1 && level <= 90, `非法等级：${value}`);
  return { elite, level };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// sharp 直接读文件路径时，libvips 会缓存文件句柄，Windows 上随后重命名/删除该文件会 EBUSY
//（实测 write→metadata()→rename 100% 复现）；因此一律先 readFile 成 Buffer 再交给 sharp，
// sharp 不持有磁盘句柄。fs.readFile 在 resolve 前就会关闭自己的句柄。
async function readImageMetadata(filePath, label) {
  const stat = await lstat(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} 必须是普通文件。`);
  return sharp(await readFile(filePath)).metadata();
}

async function validatePng(filePath, width, height, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "png", `${label} 不是 PNG。`);
  assert(metadata.width === width && metadata.height === height, `${label} 尺寸应为 ${width}×${height}。`);
}

// 头像按上游原尺寸使用，只校验文件是 PNG，不强制具体尺寸。
async function validatePngFormat(filePath, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "png", `${label} 不是 PNG。`);
}

// 已安装的头像应已是 WebP，只校验格式，不强制具体尺寸。
async function validateWebpFormat(filePath, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "webp", `${label} 不是 WebP。`);
}

async function validateProductSource(filePath, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "png", `${label} 不是 PNG。`);
  assert(metadata.width === 183 && metadata.height === 183, `${label} 尺寸应为 183×183。`);
  assert(metadata.hasAlpha, `${label} 必须包含透明通道。`);
}

async function validateProductWebp(filePath, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "webp", `${label} 不是 WebP。`);
  assert(metadata.width === 183 && metadata.height === 183, `${label} 尺寸应为 183×183。`);
  assert(metadata.hasAlpha, `${label} 必须保留透明通道。`);
}

async function inspectSourceIcon(filePath, label) {
  const metadata = await readImageMetadata(filePath, label);
  assert(metadata.format === "png", `${label} 不是 PNG。`);
  const exact = metadata.width === 36 && metadata.height === 36;
  const knownNarrowInput = metadata.width === 35 && metadata.height === 36;
  assert(exact || knownNarrowInput, `${label} 尺寸应为 36×36，最多只允许宽度缺少一个透明像素。`);
  return { normalizeWidth: knownNarrowInput };
}

function normalizeCommit(value) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/i.test(value), "必须提供 40 位上游 commit SHA。");
  return value.toLowerCase();
}

function relativeAssetPath(directory, name, extension = "png", version) {
  const pathname = `/images/${directory}/${name}.${extension}`;
  return version ? `${pathname}?v=${version}` : pathname;
}

function portraitAssetVersion(portraitsSha) {
  return `${GENERATED_VERSION}-${normalizeCommit(portraitsSha).slice(0, 12)}`;
}

async function portraitWebpInput(filePath, label) {
  const input = await readFile(filePath);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaChannel = info.channels - 1;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaChannel] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  assert(right >= left && bottom >= top, `${label} 不得是全透明图片。`);
  const visibleWidth = right - left + 1;
  const visibleHeight = bottom - top + 1;
  const targetLeft = Math.floor((info.width - visibleWidth) / 2);
  const targetTop = Math.floor((info.height - visibleHeight) / 2);
  const raw = {
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
  if (left === targetLeft && top === targetTop) return { input: data, raw };

  const centered = Buffer.alloc(data.length);
  const rowBytes = visibleWidth * info.channels;
  for (let y = 0; y < visibleHeight; y += 1) {
    const sourceOffset = ((top + y) * info.width + left) * info.channels;
    const targetOffset = ((targetTop + y) * info.width + targetLeft) * info.channels;
    data.copy(centered, targetOffset, sourceOffset, sourceOffset + rowBytes);
  }
  return {
    input: centered,
    raw,
  };
}

async function writePortraitWebp(source, target, label) {
  const { input, raw } = await portraitWebpInput(source, label);
  const output = await sharp(input, { raw }).webp(WEBP_PORTRAIT_OPTIONS).toBuffer();
  await writeFile(target, output);
}

async function loadSource(sourceRoot, sourceSha, portraitsRoot, portraitsSha) {
  assert(typeof portraitsRoot === "string" && portraitsRoot, "必须提供头像来源目录。");
  assert(typeof portraitsSha === "string" && portraitsSha, "必须提供头像来源 commit。");
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedPortraits = path.resolve(portraitsRoot);
  const normalizedSourceSha = normalizeCommit(sourceSha);
  const normalizedPortraitsSha = normalizeCommit(portraitsSha);
  const portraitVersion = portraitAssetVersion(normalizedPortraitsSha);
  const [rawCharacterData, buildingData, rawCharacterLocale, buildingLocale, termLocale] = await Promise.all([
    readJson(path.join(resolvedSource, SOURCE_PATHS.characterData), "干员数据"),
    readJson(path.join(resolvedSource, SOURCE_PATHS.buildingData), "基建数据"),
    readJson(path.join(resolvedSource, SOURCE_PATHS.characterLocale), "干员中文本地化"),
    readJson(path.join(resolvedSource, SOURCE_PATHS.buildingLocale), "基建中文本地化"),
    readJson(path.join(resolvedSource, SOURCE_PATHS.termLocale), "基建词条本地化"),
  ]);

  assert(isObject(rawCharacterData), "干员数据根节点必须是对象。");
  assert(isObject(rawCharacterLocale), "干员本地化根节点必须是对象。");
  assert(
    isObject(buildingData)
      && isObject(buildingData.char)
      && isObject(buildingData.buff?.data)
      && isObject(buildingData.buff?.info),
    "基建数据结构不完整。",
  );
  assert(isObject(buildingLocale?.buff?.name) && isObject(buildingLocale?.buff?.description), "基建本地化结构不完整。");
  assert(isObject(termLocale), "基建词条本地化结构不完整。");
  const characterData = withoutAlternateAmiya(rawCharacterData);
  const characterLocale = withoutAlternateAmiya(rawCharacterLocale);
  buildingData.char = withoutAlternateAmiya(buildingData.char);
  sameKeys(characterData, characterLocale, "干员数据", "干员本地化");
  sameKeys(characterData, buildingData.char, "干员数据", "基建技能映射");

  const roomLabels = buildingLocale.name;
  const names = new Map();
  const referencedSkillIds = new Set();
  const referencedIcons = new Set();
  const operators = [];
  const charOrder = new Map(Object.keys(buildingData.char).map((shortId, index) => [shortId, index]));
  // 技能 id → 引用该技能的干员名，用于把干员级补充标签（如九色鹿）并集进技能目录。
  const skillOperatorNames = new Map();

  for (const shortId of Object.keys(characterData).sort((left, right) => left.localeCompare(right, "en"))) {
    assert(SAFE_ASSET_NAME.test(shortId), `不安全的干员 ID：${shortId}`);
    const metadata = characterData[shortId];
    const name = characterLocale[shortId];
    const rawSkills = buildingData.char[shortId];
    assert(isObject(metadata), `干员 ${shortId} 的数据无效。`);
    assert(typeof name === "string" && name.trim(), `干员 ${shortId} 缺少中文名称。`);
    assert(!names.has(name), `干员名称重复：${name}（${names.get(name)}、${shortId}）。`);
    assert(Number.isInteger(metadata.star) && metadata.star >= 1 && metadata.star <= 6, `干员 ${shortId} 的稀有度无效。`);
    assert(Number.isInteger(metadata.profession), `干员 ${shortId} 的职业字段无效。`);
    assert(Number.isInteger(metadata.position), `干员 ${shortId} 的站位字段无效。`);
    assert(Array.isArray(rawSkills), `干员 ${shortId} 的基建技能必须是数组。`);
    names.set(name, shortId);

    const buildingSkills = rawSkills.map((rawSkill, offset) => {
      assert(isObject(rawSkill), `干员 ${shortId} 的第 ${offset + 1} 个基建技能无效。`);
      assert(typeof rawSkill.id === "string" && rawSkill.id.trim(), `干员 ${shortId} 的第 ${offset + 1} 个基建技能缺少 ID。`);
      assert(buildingData.buff.data[rawSkill.id], `干员 ${shortId} 引用了未知基建技能 ${rawSkill.id}。`);
      referencedSkillIds.add(rawSkill.id);
      const refs = skillOperatorNames.get(rawSkill.id) ?? [];
      refs.push(name);
      skillOperatorNames.set(rawSkill.id, refs);
      return {
        index: offset + 1,
        id: rawSkill.id,
        ...parseUnlock(rawSkill.unlock),
      };
    });

    operators.push({
      id: `char_${shortId}`,
      name,
      order: charOrder.get(shortId) ?? 0,
      rarity: metadata.star,
      profession: metadata.profession,
      position: metadata.position,
      portrait: relativeAssetPath("operator-portraits", shortId, "webp", portraitVersion),
      buildingSkills,
    });
  }

  const skills = [];
  for (const skillId of Object.keys(buildingData.buff.data).sort((left, right) => left.localeCompare(right, "en"))) {
    const metadata = buildingData.buff.data[skillId];
    assert(isObject(metadata), `基建技能 ${skillId} 的数据无效。`);
    assert(typeof metadata.icon === "string" && SAFE_ASSET_NAME.test(metadata.icon), `基建技能 ${skillId} 的图标名不安全。`);
    assert(typeof metadata.desc === "string" && metadata.desc.trim(), `基建技能 ${skillId} 缺少描述索引。`);
    const name = buildingLocale.buff.name[skillId];
    const rawDescription = buildingLocale.buff.description[metadata.desc];
    assert(typeof name === "string" && name.trim(), `基建技能 ${skillId} 缺少中文名称。`);
    assert(typeof rawDescription === "string" && rawDescription.trim(), `基建技能 ${skillId} 缺少中文描述。`);
    const skillInfo = buildingData.buff.info[metadata.desc];
    const room = skillInfo?.building ?? null;
    assert(
      room === null || typeof roomLabels[room] === "string",
      `基建技能 ${skillId} 的房间类型 ${room} 缺少中文名。`,
    );
    const operatorTags = (skillOperatorNames.get(skillId) ?? []).flatMap((operatorName) => operatorSupplementalTags(operatorName));
    referencedIcons.add(metadata.icon);
    skills.push({
      id: skillId,
      name,
      descriptionRich: rawDescription,
      tags: [
        ...new Set([
          ...Object.keys(skillInfo?.is ?? {}),
          ...supplementalSkillTags(room, stripGameMarkup(rawDescription)),
          ...operatorTags,
        ]),
      ],
      icon: relativeAssetPath("building-skills", metadata.icon),
    });
  }

  const terms = sortedObject(
    Object.entries(termLocale)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([termId, entry]) => {
        assert(isObject(entry), `基建词条 ${termId} 无效。`);
        assert(typeof entry.name === "string" && entry.name.trim(), `基建词条 ${termId} 缺少名称。`);
        assert(typeof entry.desc === "string" && entry.desc.trim(), `基建词条 ${termId} 缺少描述。`);
        return [termId, {
          id: termId,
          name: entry.name,
          desc: entry.desc,
          descText: stripGameMarkup(entry.desc),
        }];
      }),
  );

  for (const skillId of referencedSkillIds) {
    assert(buildingData.buff.data[skillId], `缺少被干员引用的基建技能 ${skillId}。`);
  }

  const fallbackPortraitIds = [];
  const portraitFiles = [];
  for (const operator of operators) {
    const shortId = operator.id.slice("char_".length);
    let source = path.join(resolvedPortraits, PORTRAITS_DIRECTORY, `char_${shortId}.png`);
    try {
      await lstat(source);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      source = path.join(resolvedSource, "assets/img/avatar", `${shortId}.png`);
      fallbackPortraitIds.push(operator.id);
      operator.portrait = relativeAssetPath("operator-portraits", shortId, "webp", portraitAssetVersion(normalizedSourceSha));
    }
    portraitFiles.push({
      name: `${shortId}.webp`,
      source,
    });
  }
  const iconFiles = [...referencedIcons].sort((left, right) => left.localeCompare(right, "en")).map((icon) => ({
    name: `${icon}.png`,
    source: path.join(resolvedSource, SOURCE_PATHS.buildingSkills, `${icon}.png`),
  }));
  const productFiles = PRODUCT_ASSETS.map((asset) => ({
    ...asset,
    name: `${asset.id}.webp`,
    sourcePath: path.join(asset.source === "arkntools" ? resolvedSource : resolvedPortraits, asset.path),
  }));

  await mapLimit(portraitFiles, 16, ({ source, name }) => validatePngFormat(source, `干员头像 ${name}`));
  await mapLimit(iconFiles, 16, async (file) => {
    Object.assign(file, await inspectSourceIcon(file.source, `基建技能图标 ${file.name}`));
  });
  await mapLimit(productFiles, 5, ({ sourcePath, name }) => validateProductSource(sourcePath, `产物图标 ${name}`));

  const skillCatalog = sortedObject(skills.map((skill) => [skill.id, skill]));
  const manifest = {
    version: GENERATED_VERSION,
    source: {
      repository: ARKNTOOLS_REPOSITORY,
      commit: normalizedSourceSha,
    },
    portraitsSource: {
      repository: ARKNIGHTS_GAME_RESOURCE_REPOSITORY,
      commit: normalizedPortraitsSha,
    },
    ...(fallbackPortraitIds.length ? { portraitsFallback: {
      repository: ARKNTOOLS_REPOSITORY,
      commit: normalizedSourceSha,
      directory: "assets/img/avatar",
      operators: fallbackPortraitIds,
    } } : {}),
    products: productFiles.map((file) => ({
      id: file.id,
      output: relativeAssetPath("products", file.id, "webp"),
      source: file.source,
      path: file.path,
    })),
    counts: {
      operators: operators.length,
      buildingSkills: skills.length,
      terms: Object.keys(terms).length,
      portraits: portraitFiles.length,
      buildingSkillIcons: iconFiles.length,
      productIcons: productFiles.length,
    },
  };

  return { operators, skills: skillCatalog, terms, manifest, portraitFiles, iconFiles, productFiles };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeStage(stageRoot, generated) {
  const portraitTarget = path.join(stageRoot, MANAGED_PATHS[0]);
  const iconTarget = path.join(stageRoot, MANAGED_PATHS[1]);
  const productTarget = path.join(stageRoot, MANAGED_PATHS[2]);
  const dataTarget = path.join(stageRoot, MANAGED_PATHS[3]);
  await Promise.all([mkdir(portraitTarget, { recursive: true }), mkdir(iconTarget, { recursive: true }), mkdir(productTarget, { recursive: true }), mkdir(dataTarget, { recursive: true })]);
  await mkdir(path.join(stageRoot, "fixtures"), { recursive: true });

  await Promise.all([
    mapLimit(generated.portraitFiles, 16, ({ source, name }) =>
      writePortraitWebp(source, path.join(portraitTarget, name), `干员头像 ${name}`)),
    mapLimit(generated.iconFiles, 16, ({ source, name, normalizeWidth }) => normalizeWidth
      ? sharp(source)
          .extend({ right: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png({ compressionLevel: 9 })
          .toFile(path.join(iconTarget, name))
      : copyFile(source, path.join(iconTarget, name))),
    mapLimit(generated.productFiles, 5, async ({ sourcePath, name }) => {
      const output = await sharp(await readFile(sourcePath)).webp(WEBP_PRODUCT_OPTIONS).toBuffer();
      await writeFile(path.join(productTarget, name), output);
    }),
    writeFile(path.join(dataTarget, "operator-catalog.json"), json(generated.operators), "utf8"),
    writeFile(path.join(dataTarget, "operator-pinyin.json"), json(generateOperatorPinyin(generated.operators)), "utf8"),
    writeFile(path.join(dataTarget, "operator-rarities.json"), json(Object.fromEntries(generated.operators.map(({ id, rarity }) => [id, rarity]))), "utf8"),
    writeFile(path.join(dataTarget, "building-skill-catalog.json"), json(generated.skills), "utf8"),
    writeFile(path.join(dataTarget, "term-catalog.json"), json(generated.terms), "utf8"),
    writeFile(path.join(dataTarget, "source.json"), json(generated.manifest), "utf8"),
    writeFile(path.join(stageRoot, MANAGED_PATHS[4]), json(generateFullOperatorFixture(generated.operators)), "utf8"),
  ]);
}

async function listRegularAssetNames(directory, label, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert(entry.isFile() && !entry.isSymbolicLink(), `${label} 只能包含普通文件：${entry.name}`);
    assert(entry.name.endsWith(`.${extension}`) && SAFE_ASSET_NAME.test(entry.name.slice(0, -(extension.length + 1))), `${label} 包含不安全文件名：${entry.name}`);
    files.push(entry.name);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export async function checkGeneratedAssets(root) {
  const resolvedRoot = path.resolve(root);
  const dataRoot = path.join(resolvedRoot, MANAGED_PATHS[3]);
  const [operators, skills, terms, manifest] = await Promise.all([
    readJson(path.join(dataRoot, "operator-catalog.json"), "已生成干员目录"),
    readJson(path.join(dataRoot, "building-skill-catalog.json"), "已生成基建技能目录"),
    readJson(path.join(dataRoot, "term-catalog.json"), "已生成词条目录"),
    readJson(path.join(dataRoot, "source.json"), "已生成来源清单"),
  ]);
  assert(Array.isArray(operators), "已生成干员目录必须是数组。");
  const rarities = await readJson(path.join(dataRoot, "operator-rarities.json"), "已生成干员星级索引");
  assert(JSON.stringify(rarities) === JSON.stringify(Object.fromEntries(operators.map(({ id, rarity }) => [id, rarity]))), "干员星级索引与干员目录不一致。");
  assert(isObject(skills), "已生成基建技能目录必须是对象。");
  assert(isObject(terms), "已生成词条目录必须是对象。");
  const operatorPinyin = await readJson(path.join(dataRoot, "operator-pinyin.json"), "干员拼音索引");
  assert(JSON.stringify(operatorPinyin) === JSON.stringify(generateOperatorPinyin(operators)), "干员拼音索引需要随资源同步更新。");
  assert(isObject(manifest) && manifest.version === GENERATED_VERSION, "已生成来源清单版本无效。");
  normalizeCommit(manifest.source?.commit);
  assert(manifest.source?.repository === ARKNTOOLS_REPOSITORY, "已生成来源仓库无效。");
  assert(isObject(manifest.portraitsSource), "已生成头像来源清单无效。");
  normalizeCommit(manifest.portraitsSource?.commit);
  assert(manifest.portraitsSource?.repository === ARKNIGHTS_GAME_RESOURCE_REPOSITORY, "已生成头像来源仓库无效。");
  assert(Array.isArray(manifest.products), "已生成产物来源清单无效。");
  assert(JSON.stringify(manifest.products) === JSON.stringify(PRODUCT_ASSETS.map((asset) => ({
    id: asset.id,
    output: relativeAssetPath("products", asset.id, "webp"),
    source: asset.source,
    path: asset.path,
  }))), "已生成产物来源清单与受管清单不一致。");
  const portraitVersion = portraitAssetVersion(manifest.portraitsSource.commit);
  const fallback = manifest.portraitsFallback;
  if (fallback !== undefined) {
    assert(isObject(fallback) && fallback.repository === ARKNTOOLS_REPOSITORY
      && fallback.commit === manifest.source.commit && fallback.directory === "assets/img/avatar"
      && Array.isArray(fallback.operators) && fallback.operators.length > 0
      && new Set(fallback.operators).size === fallback.operators.length, "已生成备用头像来源清单无效。");
  }
  const fallbackIds = new Set(fallback?.operators ?? []);

  const ids = new Set();
  const names = new Set();
  const portraitNames = [];
  const referencedIcons = new Set();
  for (const operator of operators) {
    assert(isObject(operator), "已生成干员条目无效。");
    assert(typeof operator.id === "string" && operator.id.startsWith("char_") && SAFE_ASSET_NAME.test(operator.id.slice(5)), `已生成干员 ID 无效：${operator.id}`);
    assert(typeof operator.name === "string" && operator.name.trim(), `已生成干员 ${operator.id} 缺少名称。`);
    assert(!ids.has(operator.id), `已生成干员 ID 重复：${operator.id}`);
    assert(!names.has(operator.name), `已生成干员名称重复：${operator.name}`);
    ids.add(operator.id);
    names.add(operator.name);
    const shortId = operator.id.slice(5);
    assert(!EXCLUDED_OPERATOR_IDS.has(shortId), `干员目录不应包含阿米娅替代形态：${operator.id}`);
    const version = fallbackIds.has(operator.id) ? portraitAssetVersion(fallback.commit) : portraitVersion;
    assert(operator.portrait === relativeAssetPath("operator-portraits", shortId, "webp", version), `干员 ${operator.id} 的头像路径无效。`);
    assert(Number.isInteger(operator.order), `干员 ${operator.id} 的原始顺序无效。`);
    portraitNames.push(`${shortId}.webp`);
    assert(Array.isArray(operator.buildingSkills), `干员 ${operator.id} 的基建技能无效。`);
    operator.buildingSkills.forEach((skill, offset) => {
      assert(skill.index === offset + 1, `干员 ${operator.id} 的基建技能序号不连续。`);
      assert(skills[skill.id], `干员 ${operator.id} 引用了未知基建技能 ${skill.id}。`);
      assert(Number.isInteger(skill.elite) && skill.elite >= 0 && skill.elite <= 2, `干员 ${operator.id} 的基建技能精英阶段无效。`);
      assert(Number.isInteger(skill.level) && skill.level >= 1 && skill.level <= 90, `干员 ${operator.id} 的基建技能等级无效。`);
      assert(!("room" in skill) && !("roomLabel" in skill) && !("tags" in skill), `干员 ${operator.id} 的基建技能不应残留房间或标签字段。`);
    });
  }

  assert([...fallbackIds].every((id) => ids.has(id)), "备用头像来源包含未知干员。");
  const fullFixture = await readJson(path.join(resolvedRoot, MANAGED_PATHS[4]), "全干员测试样例");
  assert(JSON.stringify(fullFixture) === JSON.stringify(generateFullOperatorFixture(operators)), "全干员测试样例需要随资源同步更新。");

  for (const [skillId, skill] of Object.entries(skills)) {
    assert(isObject(skill) && skill.id === skillId, `已生成基建技能 ${skillId} 无效。`);
    assert(typeof skill.name === "string" && skill.name.trim(), `已生成基建技能 ${skillId} 缺少名称。`);
    assert(typeof skill.descriptionRich === "string" && skill.descriptionRich.trim(), `已生成基建技能 ${skillId} 缺少富文本描述。`);
    const plainDescription = stripGameMarkup(skill.descriptionRich);
    assert(plainDescription, `已生成基建技能 ${skillId} 缺少纯文本描述。`);
    assert(!/<[^>]*>/.test(plainDescription), `已生成基建技能 ${skillId} 的纯文本描述仍包含富文本标记。`);
    assert(!("description" in skill), `已生成基建技能 ${skillId} 不应重复保存纯文本描述。`);
    assert(Array.isArray(skill.tags), `已生成基建技能 ${skillId} 的标签无效。`);
    assert(!("room" in skill) && !("roomLabel" in skill), `已生成基建技能 ${skillId} 不应保存可由技能 ID 推导的房间字段。`);
    const prefix = "/images/building-skills/";
    assert(typeof skill.icon === "string" && skill.icon.startsWith(prefix) && skill.icon.endsWith(".png"), `已生成基建技能 ${skillId} 的图标路径无效。`);
    const icon = skill.icon.slice(prefix.length, -4);
    assert(SAFE_ASSET_NAME.test(icon), `已生成基建技能 ${skillId} 的图标名不安全。`);
    referencedIcons.add(`${icon}.png`);
  }

  for (const [termId, term] of Object.entries(terms)) {
    assert(isObject(term) && term.id === termId, `已生成词条 ${termId} 无效。`);
    assert(typeof term.name === "string" && term.name.trim(), `已生成词条 ${termId} 缺少名称。`);
    assert(typeof term.desc === "string" && term.desc.trim(), `已生成词条 ${termId} 缺少描述。`);
    assert(typeof term.descText === "string" && term.descText.trim(), `已生成词条 ${termId} 缺少纯文本描述。`);
    assert(!/<[^>]*>/.test(term.descText), `已生成词条 ${termId} 的纯文本描述仍包含富文本标记。`);
  }

  const portraitDirectory = path.join(resolvedRoot, MANAGED_PATHS[0]);
  const iconDirectory = path.join(resolvedRoot, MANAGED_PATHS[1]);
  const productDirectory = path.join(resolvedRoot, MANAGED_PATHS[2]);
  const [actualPortraits, actualIcons, actualProducts] = await Promise.all([
    listRegularAssetNames(portraitDirectory, "干员头像目录", "webp"),
    listRegularAssetNames(iconDirectory, "基建技能图标目录", "png"),
    listRegularAssetNames(productDirectory, "产物图标目录", "webp"),
  ]);
  const expectedPortraits = portraitNames.sort((left, right) => left.localeCompare(right, "en"));
  const expectedIcons = [...referencedIcons].sort((left, right) => left.localeCompare(right, "en"));
  assert(JSON.stringify(actualPortraits) === JSON.stringify(expectedPortraits), "干员头像目录与生成目录不一致。");
  assert(JSON.stringify(actualIcons) === JSON.stringify(expectedIcons), "基建技能图标目录与生成目录不一致。");
  const expectedProducts = PRODUCT_ASSETS.map((asset) => `${asset.id}.webp`).sort((left, right) => left.localeCompare(right, "en"));
  assert(JSON.stringify(actualProducts) === JSON.stringify(expectedProducts), "产物图标目录与生成目录不一致。");
  assert(manifest.counts?.operators === operators.length, "来源清单的干员数量不一致。");
  assert(manifest.counts?.buildingSkills === Object.keys(skills).length, "来源清单的基建技能数量不一致。");
  assert(manifest.counts?.terms === Object.keys(terms).length, "来源清单的词条数量不一致。");
  assert(manifest.counts?.portraits === actualPortraits.length, "来源清单的头像数量不一致。");
  assert(manifest.counts?.buildingSkillIcons === actualIcons.length, "来源清单的技能图标数量不一致。");
  assert(manifest.counts?.productIcons === actualProducts.length, "来源清单的产物图标数量不一致。");

  await mapLimit(actualPortraits, 16, (name) => validateWebpFormat(path.join(portraitDirectory, name), `干员头像 ${name}`));
  await mapLimit(actualIcons, 16, (name) => validatePng(path.join(iconDirectory, name), 36, 36, `基建技能图标 ${name}`));
  await mapLimit(actualProducts, 5, (name) => validateProductWebp(path.join(productDirectory, name), `产物图标 ${name}`));
  return manifest;
}

async function existingManifest(root) {
  try {
    return await readJson(path.join(root, MANAGED_PATHS[3], "source.json"), "现有来源清单");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function existingManagedFiles(root) {
  const files = new Set();
  for (const relative of MANAGED_PATHS) {
    const target = path.join(root, relative);
    try {
      if ((await lstat(target)).isFile()) {
        files.add(relative);
        continue;
      }
      const entries = await readdir(target, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) files.add(path.join(relative, entry.parentPath ? path.relative(target, entry.parentPath) : "", entry.name).replaceAll("\\", "/"));
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return files;
}

async function desiredManagedFiles(stageRoot) {
  return existingManagedFiles(stageRoot);
}

// Windows 上文件监视器、索引服务或杀毒软件可能在目录换名/删除瞬间短暂持有句柄，
// 导致 rename/rm 偶发 EPERM/EACCES/EBUSY/ENOTEMPTY。撞锁时按递增间隔重试直到
// WINDOWS_LOCK_TIMEOUT_MS；无锁时第一次尝试即成功，重试不产生额外等待。
const WINDOWS_LOCK_TIMEOUT_MS = 30_000;

async function retryWindowsLock(operation) {
  const startedAt = Date.now();
  const retriableCodes = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && retriableCodes.has(error.code))) throw error;
      if (Date.now() - startedAt >= WINDOWS_LOCK_TIMEOUT_MS) throw error;
      await delay(Math.min(200 * attempt, 1500));
    }
  }
}

async function renameWithRetry(source, target) {
  await retryWindowsLock(() => rename(source, target));
}

async function removeWithRetry(target, options) {
  await retryWindowsLock(() => rm(target, options));
}

async function installStage(root, stageRoot) {
  const backupRoot = await mkdtemp(path.join(root, ".tmp", "arkntools-assets-backup-"));
  const installed = [];
  const backedUp = [];
  try {
    for (const relative of MANAGED_PATHS) {
      const target = path.join(root, relative);
      const staged = path.join(stageRoot, relative);
      const backup = path.join(backupRoot, relative);
      assertInside(root, target, `受管路径 ${relative}`);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await lstat(target);
        await mkdir(path.dirname(backup), { recursive: true });
        await renameWithRetry(target, backup);
        backedUp.push({ target, backup });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
      await renameWithRetry(staged, target);
      installed.push(target);
    }
  } catch (error) {
    for (const target of installed.reverse()) await removeWithRetry(target, { recursive: true, force: true });
    for (const { target, backup } of backedUp.reverse()) await renameWithRetry(backup, target);
    throw error;
  } finally {
    await removeWithRetry(backupRoot, { recursive: true, force: true });
  }
}

export async function generateAssets({ sourceRoot, sourceSha, portraitsRoot, portraitsSha, outputRoot, allowRemovals = false }) {
  const root = path.resolve(outputRoot);
  const generated = await loadSource(sourceRoot, sourceSha, portraitsRoot, portraitsSha);
  const currentManifest = await existingManifest(root);
  if (currentManifest && generated.manifest.counts.operators < currentManifest.counts?.operators && !allowRemovals) {
    throw new Error(`上游干员数量从 ${currentManifest.counts.operators} 降至 ${generated.manifest.counts.operators}；请人工确认后使用 --allow-removals。`);
  }

  await mkdir(path.join(root, ".tmp"), { recursive: true });
  const stageRoot = await mkdtemp(path.join(root, ".tmp", "arkntools-assets-stage-"));
  try {
    await writeStage(stageRoot, generated);
    // Windows 杀毒/索引服务会对刚批量写入的图片短暂加锁；先停顿让扫描完成，
    // 再进入校验/安装，减少后续重命名整棵树时被 EBUSY 卡住的概率。
    await delay(1000);
    await checkGeneratedAssets(stageRoot);
    const [beforeFiles, afterFiles] = await Promise.all([existingManagedFiles(root), desiredManagedFiles(stageRoot)]);
    const removals = [...beforeFiles].filter((file) => !afterFiles.has(file)).sort();
    if (removals.length > 0 && !allowRemovals) {
      throw new Error(`本次更新将删除 ${removals.length} 个受管文件；请人工确认后使用 --allow-removals。首个文件：${removals[0]}`);
    }
    await installStage(root, stageRoot);
    await checkGeneratedAssets(root);
    return { manifest: generated.manifest, removals };
  } finally {
    await removeWithRetry(stageRoot, { recursive: true, force: true });
  }
}
