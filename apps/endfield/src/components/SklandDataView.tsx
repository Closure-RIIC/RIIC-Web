import { useState, type ReactNode } from "react";
import { Section } from "@riic/endfield-ui";
import { detailLabels, type DetailRecord, type DetailValue } from "@riic/endfield-skland/details";
import type { EndfieldRole, EndfieldSnapshot } from "@riic/endfield-skland/model";
import { useWorkspace } from "../state";
import { SklandProgress } from "./SklandProgress";
import { SklandInventory } from "./SklandInventory";
import { Tabs, CompactTabsList, TabsTrigger, TabsContent } from "@riic/ui-primitives/tabs";
import { SearchInput } from "@riic/ui-primitives/search-input";
import { physicalStrengthPercent, quantity, shipFavorability, shipRoomsForDisplay, sortShipCrewByMood } from "@riic/endfield-skland/presentation";
import { operatorData, weaponData } from "@riic/endfield-data";
import { GameArtwork, OperatorPortrait } from "./GameArtwork";

const record = (value: DetailValue | undefined): DetailRecord => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const items = (value: DetailValue | undefined) => Array.isArray(value) ? value : [];
const nameOf = (value: DetailValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const imageUrl = (value: DetailValue | undefined) => typeof value === "string" && /^https:\/\//.test(value) ? value : undefined;
const countOf = (value: DetailValue) => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
const favorabilityLevels = { friendly: { zh: "友好", en: "Friendly" }, close: { zh: "亲近", en: "Close" }, trusted: { zh: "信任", en: "Trusted" } } as const;

function Disclosure({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="ef-data-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}{count !== undefined ? <small>{count}</small> : null}</summary>
    {open ? <div className="ef-data-expanded">{children}</div> : null}
  </details>;
}

/** Details within the selected categories render only when expanded. */
function DataFields({ value, names, field = "" }: { value: DetailValue; names: Map<string, string>; field?: string }) {
  const { locale, t } = useWorkspace();
  const label = (key: string) => detailLabels[key]?.[locale === "zh" ? 0 : 1] ?? names.get(key) ?? key;
  if (value === null) return <span className="ef-muted">{t("暂无数据", "No data")}</span>;
  if (typeof value === "boolean") return <span>{value ? t("是", "Yes") : t("否", "No")}</span>;
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value);
    if (imageUrl(value) && /url|icon|avatar|illustration/i.test(field)) {
      return <img className="ef-data-image" src={raw} alt={label(field)} loading="lazy" referrerPolicy="no-referrer" />;
    }
    if (/^(?:createTime|lastLoginTime|saveTime|currentTs|ownTs|maxTs|createdTimeTs)$/.test(field) && /^\d{10,13}$/.test(raw)) {
      const date = new Date(Number(raw) * (raw.length <= 10 ? 1000 : 1));
      return <time dateTime={date.toISOString()}>{date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</time>;
    }
    return <span>{names.get(raw) ?? (raw.replace(/<[^>]*>/g, "") || t("未设置", "Not set"))}</span>;
  }
  if (!countOf(value)) return <span className="ef-muted">{t("暂无数据", "No data")}</span>;
  if (Array.isArray(value)) return <div className="ef-data-list">{value.map((item, i) => {
    if (item && typeof item === "object") {
      const row = record(item);
      return <Disclosure key={i} title={nameOf(row.name) || nameOf(row.description) || names.get(nameOf(row.charId)) || `${t("记录", "Record")} ${i + 1}`}>
        <DataFields value={item} names={names} />
      </Disclosure>;
    }
    return <div key={i}><DataFields value={item} names={names} field={field} /></div>;
  })}</div>;
  return <dl className="ef-data-fields">{Object.entries(value).map(([key, item]) =>
    <div key={key} className={item && typeof item === "object" ? "ef-data-field--nested" : undefined}>
      <dt>{label(key)}</dt><dd>{item && typeof item === "object"
        ? <Disclosure title={t("查看详情", "View details")} count={countOf(item)}><DataFields value={item} names={names} field={key} /></Disclosure>
        : <DataFields value={item} names={names} field={key} />}</dd>
    </div>)}</dl>;
}

function StatusCard({ title, current, max, description }: { title: string; current: number | null; max: number | null; description: string }) {
  return <article className="ef-status-card"><h3>{title}</h3>
    <SklandProgress label={title} current={current} max={max} />
    <p className="ef-muted">{description}</p></article>;
}

function ProgressDetails({ label, data, currentKey, maxKey, names }: {
  label: string; data: DetailRecord; currentKey: string; maxKey: string; names: Map<string, string>;
}) {
  const remaining = Object.fromEntries(Object.entries(data).filter(([key]) => key !== currentKey && key !== maxKey));
  return <>
    <SklandProgress label={label} current={quantity(data[currentKey])} max={quantity(data[maxKey])} compact />
    {Object.keys(remaining).length ? <DataFields value={remaining} names={names} /> : null}
  </>;
}

export function SklandProfile({ snapshot, role, accountLabel }: { snapshot: EndfieldSnapshot | null; role?: EndfieldRole; accountLabel?: string }) {
  const { t, locale } = useWorkspace();
  const base = record(snapshot?.details?.base);
  const name = snapshot?.role.name || role?.nickname || accountLabel || t("森空岛账号", "Skland account");
  const server = snapshot?.role.serverName || role?.serverName;
  const uid = snapshot?.role.roleId || role?.roleId;
  return <div className="ef-skland-profile">
    <GameArtwork src={imageUrl(base.avatarUrl)} name={name} size={56} />
    <div className="ef-skland-profile-copy">
      <div className="ef-skland-profile-name"><h2>{name}</h2>{snapshot ? <span className="ef-skland-level">Lv.{snapshot.role.level}</span> : null}</div>
      <div className="ef-skland-profile-meta">
        {server ? <span>{server}</span> : null}
        {uid ? <span>UID {uid}</span> : null}
        {snapshot ? <span>{t("同步于 ", "Synced ")}{new Date(snapshot.fetchedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</span> : null}
      </div>
    </div>
  </div>;
}

export function SklandDataView({ snapshot }: { snapshot: EndfieldSnapshot }) {
  const { t, locale } = useWorkspace();
  const [search, setSearch] = useState("");
  const [weaponSearch, setWeaponSearch] = useState("");
  const data: DetailRecord = snapshot.details ?? { base: snapshot.role, chars: snapshot.characters, spaceShip: { rooms: snapshot.rooms } };
  const base = record(data.base), sanity = record(data.dungeon), daily = record(data.dailyMission), pass = record(data.bpSystem);
  const allChars = items(data.chars);
  const names = new Map(snapshot.characters.map(char => [char.id, char.name]));
  for (const item of allChars) {
    const char = record(item), profile = record(char.charData);
    if (nameOf(char.id) && nameOf(profile.name)) names.set(nameOf(char.id), nameOf(profile.name));
  }
  const characters = allChars.filter(item => {
    const char = record(item), profile = record(char.charData), display = operatorData(nameOf(profile.id));
    return [nameOf(profile.name), nameOf(char.name), display?.enName].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  });
  const rooms = shipRoomsForDisplay(items(record(data.spaceShip).rooms));
  const fullWeapons = snapshot.weapons?.status === "ready";
  // An unavailable calculator list must never masquerade as an empty inventory.
  const equipped = allChars.flatMap(item => {
    const char = record(item), weapon = record(char.weapon), profile = record(weapon.weaponData);
    if (!Object.keys(weapon).length) return [];
    return [{ key: nameOf(char.id), id: nameOf(profile.id) || nameOf(weapon.weaponId) || nameOf(weapon.id),
      name: nameOf(profile.name), icon: imageUrl(profile.iconUrl) || imageUrl(profile.icon),
      level: quantity(weapon.level), breakthrough: quantity(weapon.breakthroughLevel), refine: quantity(weapon.refineLevel),
      owner: names.get(nameOf(char.id)) || nameOf(record(char.charData).name) }];
  });
  const weaponRows = fullWeapons || snapshot.weapons?.items.length ? (snapshot.weapons?.items ?? []).map(w => ({
    key: w.instanceId, id: w.id, name: "", icon: undefined as string | undefined, level: w.level,
    breakthrough: w.breakthroughLevel, refine: w.refineLevel, owner: "",
  })) : equipped;
  const filteredWeapons = weaponRows.filter(w => {
    const display = weaponData(w.id);
    return [w.name, display?.name, display?.enName, w.id].join(" ").toLowerCase().includes(weaponSearch.trim().toLowerCase());
  });
  const activation = quantity(daily.dailyActivation), maxActivation = quantity(daily.maxDailyActivation);
  const currentSanity = quantity(sanity.curStamina), maxSanity = quantity(sanity.maxStamina);
  const unknown = t("暂未获取", "Not available");
  const roomNames: Record<string, string> = { "0": t("总控中枢", "Control center"), "1": t("制造舱", "Manufacturing"), "2": t("培养舱", "Growth"), "3": t("会客室", "Reception"), "5": t("会客室线索", "Reception clues") };
  return <div data-skland-data>
    <Tabs defaultValue="overview" className="ef-sync-tabs">
      <CompactTabsList aria-label={t("森空岛数据分类", "Skland data categories")}>
        {[["overview", t("状态总览", "Overview")], ["operators", t("干员状态", "Operators")], ["weapons", t("武器状态", "Weapons")], ["inventory", t("仓库背包", "Inventory")], ["ship", t("帝江号", "Dijiang")]].map(([id, title]) => <TabsTrigger key={id} value={id}>{title}</TabsTrigger>)}
      </CompactTabsList>
      <TabsContent value="overview">
        <div className="ef-status-grid">
          <StatusCard title={t("理智", "Sanity")} current={currentSanity} max={maxSanity}
            description={currentSanity === null || maxSanity === null ? unknown : currentSanity >= maxSanity ? t("理智已满", "Sanity full") : t("尚未回满", "Recovering")} />
          <StatusCard title={t("每日任务", "Daily missions")} current={activation} max={maxActivation}
            description={activation === null || maxActivation === null || maxActivation <= 0 ? unknown : activation >= maxActivation ? t("今日任务已完成", "Daily missions complete") : t("今日任务未完成", "Daily missions incomplete")} />
          <StatusCard title={t("通行证", "Battle pass")} current={quantity(pass.curLevel)} max={quantity(pass.maxLevel)}
            description={pass.curLevel == null ? unknown : t("当前通行证等级", "Current battle pass level")} />
        </div>
        <Section title={t("角色信息", "Character information")}><DataFields value={Object.fromEntries(Object.entries(base).filter(([key]) => !["avatarUrl", "name", "roleId", "serverName"].includes(key)))} names={names} /></Section>
        <Section title={t("日常详情", "Daily details")}><div className="ef-data-columns">
          {data.dungeon ? <Disclosure title={t("理智恢复", "Sanity recovery")}><ProgressDetails label={t("理智恢复", "Sanity recovery")} data={sanity} currentKey="curStamina" maxKey="maxStamina" names={names} /></Disclosure> : null}
          {data.bpSystem ? <Disclosure title={t("通行证进度", "Battle pass progress")}><ProgressDetails label={t("通行证进度", "Battle pass progress")} data={pass} currentKey="curLevel" maxKey="maxLevel" names={names} /></Disclosure> : null}
        </div></Section>
      </TabsContent>
      <TabsContent value="operators"><Section>
        <SearchInput containerClassName="ef-sync-search" label={t("搜索干员", "Search operators")} placeholder={t("搜索干员", "Search operators")} value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch("")} clearLabel={t("清空搜索", "Clear search")} />
        <div className="ef-data-cards">{characters.map((item, i) => {
          const char = record(item), profile = record(char.charData), display = operatorData(nameOf(profile.id) || nameOf(profile.name));
          const weapon = record(char.weapon), weaponProfile = record(weapon.weaponData), weaponDisplay = weaponData(nameOf(weaponProfile.id) || nameOf(weapon.weaponId));
          const name = (locale === "en" ? display?.enName : display?.name) || nameOf(profile.name) || nameOf(char.name) || nameOf(char.id);
          return <article className="ef-data-card" key={nameOf(char.id) || i}>
            <header><OperatorPortrait name={display?.id || name} size={56} elite={quantity(char.evolvePhase ?? char.elite)} /><div><h3>{name}</h3><p>Lv.{nameOf(char.level) || "—"} · E{nameOf(char.evolvePhase ?? char.elite) || "—"}{char.potentialLevel !== undefined ? ` · ${t("潜能", "Potential")} ${nameOf(char.potentialLevel)}` : ""}</p></div></header>
            <p className="ef-muted">{[record(profile.profession).value, record(profile.property).value, record(profile.rarity).value].map(nameOf).filter(Boolean).join(" · ")}</p>
            {weaponProfile.name || weaponDisplay ? <div className="ef-equipped-weapon"><GameArtwork src={weaponDisplay?.icon || imageUrl(weaponProfile.iconUrl)} name={nameOf(weaponProfile.name)} size={36} /><span>{(locale === "en" ? weaponDisplay?.enName : weaponDisplay?.name) || nameOf(weaponProfile.name)} · Lv.{nameOf(weapon.level) || "—"}</span></div> : null}
            <Disclosure title={t("干员、技能与装备详情", "Operator, skills & equipment")}><DataFields value={Object.fromEntries(Object.entries(char).filter(([key]) => key !== "charData"))} names={names} /></Disclosure>
          </article>;
        })}</div>{!characters.length ? <p className="ef-muted">{t("没有符合条件的干员。", "No matching operators.")}</p> : null}
        {snapshot.rosterComplete === false ? <p className="ef-sync-note">{t("仅显示森空岛已公开的干员。", "Only operators made visible in Skland are shown.")}</p> : null}
      </Section></TabsContent>
      <TabsContent value="weapons"><Section>
        <SearchInput containerClassName="ef-sync-search" label={t("搜索武器", "Search weapons")} placeholder={t("搜索武器", "Search weapons")} value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)} onClear={() => setWeaponSearch("")} clearLabel={t("清空搜索", "Clear search")} />
        <div className="ef-data-cards">{filteredWeapons.map(weapon => {
          const display = weaponData(weapon.id), name = (locale === "en" ? display?.enName : display?.name) || weapon.name || weapon.id;
          return <article className="ef-data-card" key={weapon.key}><header><GameArtwork src={display?.icon || weapon.icon} name={name} size={64} /><div><h3>{name}</h3><p>{display ? `${display.rarity}★ · ` : ""}Lv.{weapon.level ?? "—"}</p></div></header>
            <dl className="ef-data-fields"><div><dt>{t("突破", "Breakthrough")}</dt><dd>{weapon.breakthrough ?? "—"}</dd></div><div><dt>{t("精炼", "Refinement")}</dt><dd>{weapon.refine ?? "—"}</dd></div></dl>
            {weapon.owner ? <p className="ef-muted">{t("装备于 ", "Equipped by ")}{weapon.owner}</p> : null}
          </article>;
        })}</div>{!filteredWeapons.length ? <p className="ef-muted">{t("暂无符合条件的武器。", "No matching weapons.")}</p> : null}
        {!fullWeapons ? <p className="ef-sync-note">{snapshot.weapons?.items.length ? t("武器列表未完整返回，仅展示已获取部分。", "The weapon list is incomplete; available records are shown.") : t("完整武器仓库暂未获取，仅显示已公开干员装备的武器。", "Full weapon inventory is unavailable. Showing weapons equipped by visible operators only.")}</p> : null}
      </Section></TabsContent>
      <TabsContent value="inventory"><SklandInventory inventory={snapshot.inventory} /></TabsContent>
      <TabsContent value="ship"><Section>
        {!rooms.length ? <p className="ef-muted">{t("森空岛暂未返回帝江号数据。", "No ship data returned.")}</p> : <div className="ef-data-cards">{rooms.map((item, i) => {
          const room = record(item);
          return <article className="ef-data-card" key={nameOf(room.id) || i}><header><h3>{nameOf(room.name) || roomNames[nameOf(room.type)] || t("设施", "Facility")} · Lv.{nameOf(room.level)}</h3></header>
            <div className="ef-ship-crew">{sortShipCrewByMood(items(room.chars)).map((item, index) => {
              const char = record(item), id = nameOf(char.charId), op = operatorData(id), name = (locale === "en" ? op?.enName : op?.name) || names.get(id) || id;
              const mood = physicalStrengthPercent(char.physicalStrength) ?? "—";
              const favorability = shipFavorability(char.favorability);
              const level = favorability ? favorabilityLevels[favorability.level][locale] : "";
              const trust = favorability ? (locale === "zh" ? `${favorability.percent}（${level}）` : `${favorability.percent} (${level})`) : "—";
              return <div key={index}><OperatorPortrait name={op?.id || id} size={40} elite={snapshot.characters.find(operator => operator.id === id)?.elite ?? null} /><span>{name}<small>{t("心情", "Mood")} {mood} · {t("信赖", "Trust")} {trust}</small></span></div>;
            })}</div>
            <DataFields value={Object.fromEntries(Object.entries(room).filter(([key]) => !["id", "name", "type", "level", "chars"].includes(key)))} names={names} />
          </article>;
        })}</div>}
        <DataFields value={Object.fromEntries(Object.entries(record(data.spaceShip)).filter(([key]) => key !== "rooms"))} names={names} />
      </Section></TabsContent>
    </Tabs>
  </div>;
}
