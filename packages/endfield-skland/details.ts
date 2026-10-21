/** Display-only game data. Credentials and transport metadata never belong here. */
export type DetailValue = null | boolean | number | string | DetailValue[] | { [key: string]: DetailValue };
export type DetailRecord = { [key: string]: DetailValue };

const privateKey = /^(?:cred|credentials?|cookies?|authorization|password|secret|session|sessionId|oauth|device.?id|dId|sign|signature|headers|__proto__|constructor|prototype)$|token$|secret$|api.?key$/i;

export function publicEndfieldDetails(input: Record<string, unknown>): DetailRecord {
  let nodes = 0;
  function visit(value: unknown, depth: number): DetailValue {
    if (++nodes > 150000 || depth > 20) throw new Error("森空岛角色数据过大，请稍后重新同步。");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      if (value.length > 100000) throw new Error("森空岛角色字段过长，请稍后重新同步。");
      // Image/link fields can contain URLs; never send embedded credentials to the client.
      if (/^https?:\/\//i.test(value)) {
        try {
          const url = new URL(value);
          if (url.username || url.password || [...url.searchParams.keys()].some(key => privateKey.test(key))) return null;
        } catch { return null; }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKey.test(key))
        .map(([key, item]) => [key, visit(item, depth + 1)]));
    }
    return null;
  }
  return visit(input, 0) as DetailRecord;
}

/** The status center exposes only requested categories, even if upstream adds more. */
export function selectedEndfieldDetails(input: Record<string, unknown>): DetailRecord {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const pick = (value: unknown, keys: string[]) => Object.fromEntries(Object.entries(record(value)).filter(([key]) => keys.includes(key)));
  const selected: Record<string, unknown> = {
    base: pick(input.base, ["roleId", "name", "serverName", "level", "exp", "avatarUrl", "worldLevel", "charNum", "weaponNum", "createTime", "lastLoginTime"]),
    chars: Array.isArray(input.chars) ? input.chars.map(value => {
      const char = pick(value, ["id", "charData", "level", "evolvePhase", "potentialLevel", "ownTs", "weapon", "bodyEquip", "armEquip", "firstAccessory", "secondAccessory", "userSkills"]);
      char.charData = pick(char.charData, ["id", "name", "rarity", "profession", "property", "avatarSqUrl", "avatarRtUrl"]);
      return char;
    }) : [],
  };
  for (const key of ["dungeon", "dailyMission", "bpSystem", "spaceShip"]) if (input[key] != null) selected[key] = input[key];
  // Older card responses nested the ship in domain. Retain only the ship.
  if (!selected.spaceShip && Array.isArray(input.domain)) {
    const ships = input.domain.map(value => record(value).spaceShip).filter(Boolean);
    if (ships.length) selected.spaceShip = { rooms: ships.flatMap(ship => Array.isArray(record(ship).rooms) ? record(ship).rooms as unknown[] : []) };
  }
  return publicEndfieldDetails(selected);
}

/** Upstream may add fields. Keep them readable instead of silently dropping them. */
export const detailLabels: Record<string, [string, string]> = {
  base: ["角色信息", "Character"], chars: ["干员", "Operators"], spaceShip: ["帝江号", "Dijiang"],
  domain: ["地区与探索", "Regions & exploration"], achieve: ["成就", "Achievements"],
  bpSystem: ["通行证", "Battle pass"], dailyMission: ["每日任务", "Daily missions"],
  dungeon: ["理智", "Sanity"], config: ["数据公开设置", "Visibility"], currentTs: ["数据时间", "Data time"],
  avatarUrl: ["头像", "Avatar"], charNum: ["干员数量", "Operators"], createTime: ["注册时间", "Created"],
  docNum: ["档案数量", "Documents"], exp: ["经验", "Experience"], gender: ["性别", "Gender"],
  lastLoginTime: ["上次登录", "Last login"], level: ["等级", "Level"], mainMission: ["主线任务", "Main mission"],
  description: ["描述", "Description"], desc: ["说明", "Description"], id: ["编号", "ID"],
  name: ["名称", "Name"], roleId: ["角色 UID", "Role UID"], saveTime: ["存档时间", "Save time"],
  serverName: ["服务器", "Server"], weaponNum: ["武器数量", "Weapons"], worldLevel: ["世界等级", "World level"],
  curLevel: ["当前等级", "Current level"], maxLevel: ["等级上限", "Max level"],
  ownTs: ["获得时间", "Obtained"], potentialLevel: ["潜能", "Potential"], evolvePhase: ["精英阶段", "Elite"],
  armEquip: ["护手", "Arm equipment"], bodyEquip: ["护甲", "Body equipment"],
  firstAccessory: ["配件一", "Accessory 1"], secondAccessory: ["配件二", "Accessory 2"],
  weapon: ["武器", "Weapon"], weapons: ["武器", "Weapons"], breakthroughLevel: ["突破", "Breakthrough"],
  gem: ["基质", "Essence"], icon: ["图标", "Icon"], iconUrl: ["图标", "Icon"],
  refineLevel: ["精炼", "Refinement"], weaponData: ["武器信息", "Weapon details"],
  function: ["效果", "Effect"], rarity: ["稀有度", "Rarity"], skills: ["技能", "Skills"],
  type: ["类型", "Type"], charData: ["干员资料", "Operator profile"],
  avatarRtUrl: ["半身像", "Portrait"], avatarSqUrl: ["头像", "Avatar"], illustrationUrl: ["立绘", "Illustration"],
  labelType: ["标签类别", "Label type"], profession: ["职业", "Profession"], property: ["属性", "Attribute"],
  descLevelParams: ["各等级效果", "Effects by level"], descParams: ["效果参数", "Effect parameters"],
  params: ["参数", "Parameters"], tags: ["标签", "Tags"], weaponType: ["武器类型", "Weapon type"],
  tacticalItem: ["战术道具", "Tactical item"], activeEffectType: ["主动效果类别", "Active effect type"],
  activeEffect: ["主动效果", "Active effect"], passiveEffect: ["被动效果", "Passive effect"],
  activeEffectParams: ["主动效果参数", "Active parameters"], passiveEffectParams: ["被动效果参数", "Passive parameters"],
  userSkills: ["技能等级", "Skill levels"], skillId: ["技能编号", "Skill ID"],
  charIds: ["公开干员", "Visible operators"], charSwitch: ["干员公开", "Operators visible"],
  dailyActivation: ["今日活跃", "Daily activity"], maxDailyActivation: ["活跃上限", "Activity limit"],
  collections: ["探索收集", "Collections"], blackboxCount: ["黑箱", "Blackboxes"], levelId: ["区域编号", "Area ID"],
  pieceCount: ["收集物", "Collectibles"], puzzleCount: ["解谜", "Puzzles"], trchestCount: ["宝箱", "Chests"],
  domainId: ["地区编号", "Region ID"], factory: ["工业", "Factory"], moneyMgr: ["调度券", "Regional currency"],
  curStamina: ["当前理智", "Current sanity"], maxStamina: ["理智上限", "Max sanity"], maxTs: ["回满时间", "Full at"],
  settlements: ["据点", "Settlements"], officerCharIds: ["驻守干员", "Assigned operators"], remainMoney: ["剩余资金", "Remaining funds"],
  quickaccess: ["快捷入口", "Quick links"], link: ["链接", "Link"], rooms: ["设施", "Facilities"],
  charId: ["干员", "Operator"], favorability: ["信赖", "Trust"], physicalStrength: ["心情", "Mood"],
  reports: ["生产报告", "Production reports"], char: ["参与干员", "Operators"], createdTimeTs: ["生成时间", "Created"],
  output: ["产出", "Output"], achieveMedals: ["成就勋章", "Medals"], count: ["数量", "Count"],
  display: ["展示", "Display"], equipData: ["装备信息", "Equipment"], isAccessory: ["配件", "Accessory"],
  pkg: ["套装", "Set"], properties: ["属性", "Attributes"], key: ["标识", "Key"], value: ["内容", "Value"],
};
