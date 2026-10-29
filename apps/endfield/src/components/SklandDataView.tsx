import { useEndfieldLanguage } from "../i18n/client";
import { displayText } from "../i18n/game-data";
const detailFieldKeys = new Set(["base","chars","spaceShip","domain","achieve","bpSystem","dailyMission","dungeon","config","currentTs","avatarUrl","charNum","createTime","docNum","exp","gender","lastLoginTime","level","mainMission","description","desc","id","name","roleId","saveTime","serverName","weaponNum","worldLevel","curLevel","maxLevel","ownTs","potentialLevel","evolvePhase","armEquip","bodyEquip","firstAccessory","secondAccessory","weapon","weapons","breakthroughLevel","gem","icon","iconUrl","refineLevel","weaponData","function","rarity","skills","type","charData","avatarRtUrl","avatarSqUrl","illustrationUrl","labelType","profession","property","descLevelParams","descParams","params","tags","weaponType","tacticalItem","activeEffectType","activeEffect","passiveEffect","activeEffectParams","passiveEffectParams","userSkills","skillId","charIds","charSwitch","dailyActivation","maxDailyActivation","collections","blackboxCount","levelId","pieceCount","puzzleCount","trchestCount","domainId","factory","moneyMgr","curStamina","maxStamina","maxTs","settlements","officerCharIds","remainMoney","quickaccess","link","rooms","charId","favorability","physicalStrength","reports","char","createdTimeTs","output","achieveMedals","count","display","equipData","isAccessory","pkg","properties","key","value","talent","latestSpaceshipSkillNodes","nodeId","weaponId","skillLevel"]);
import { useState, type ReactNode } from "react";
import { Section } from "@riic/endfield-ui";
import { type DetailRecord, type DetailValue } from "@riic/endfield-skland/details";
import type { EndfieldRole, EndfieldSnapshot } from "@riic/endfield-skland/model";
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
const favorabilityLevels = { friendly: "SklandDataView.friendly", close: "SklandDataView.close", trusted: "SklandDataView.trusted" } as const;

function Disclosure({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="ef-data-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}{count !== undefined ? <small>{count}</small> : null}</summary>
    {open ? <div className="ef-data-expanded">{children}</div> : null}
  </details>;
}

/** Details within the selected categories render only when expanded. */
function DataFields({ value, names, field = "" }: { value: DetailValue; names: Map<string, string>; field?: string }) {
  const { locale, t } = useEndfieldLanguage();
  const label = (key: string) => detailFieldKeys.has(key) ? t(`SklandFields.${key}`) : names.get(key) ?? key;
  if (value === null) return <span className="ef-muted">{t("SklandDataView.noData")}</span>;
  if (typeof value === "boolean") return <span>{value ? t("SklandDataView.yes") : t("SklandDataView.no")}</span>;
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value);
    if (imageUrl(value) && /url|icon|avatar|illustration/i.test(field)) {
      return <img className="ef-data-image" src={raw} alt={label(field)} loading="lazy" referrerPolicy="no-referrer" />;
    }
    if (/^(?:createTime|lastLoginTime|saveTime|currentTs|ownTs|maxTs|createdTimeTs)$/.test(field) && /^\d{10,13}$/.test(raw)) {
      const date = new Date(Number(raw) * (raw.length <= 10 ? 1000 : 1));
      return <time dateTime={date.toISOString()}>{date.toLocaleString(locale)}</time>;
    }
    return <span>{names.get(raw) ?? (raw.replace(/<[^>]*>/g, "") || t("SklandDataView.notSet"))}</span>;
  }
  if (!countOf(value)) return <span className="ef-muted">{t("SklandDataView.noData")}</span>;
  if (Array.isArray(value)) return <div className="ef-data-list">{value.map((item, i) => {
    if (item && typeof item === "object") {
      const row = record(item);
      return <Disclosure key={i} title={names.get(nameOf(row.charId)) || displayText(operatorData(nameOf(row.name)), "name", locale) || nameOf(row.name) || nameOf(row.description) || `${t("SklandDataView.record")} ${i + 1}`}>
        <DataFields value={item} names={names} />
      </Disclosure>;
    }
    return <div key={i}><DataFields value={item} names={names} field={field} /></div>;
  })}</div>;
  return <dl className="ef-data-fields">{Object.entries(value).map(([key, item]) =>
    <div key={key} className={item && typeof item === "object" ? "ef-data-field--nested" : undefined}>
      <dt>{label(key)}</dt><dd>{item && typeof item === "object"
        ? <Disclosure title={t("SklandDataView.viewDetails")} count={countOf(item)}><DataFields value={item} names={names} field={key} /></Disclosure>
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
  const { t, locale } = useEndfieldLanguage();
  const base = record(snapshot?.details?.base);
  const name = snapshot?.role.name || role?.nickname || accountLabel || t("SklandDataView.sklandAccount");
  const server = snapshot?.role.serverName || role?.serverName;
  const uid = snapshot?.role.roleId || role?.roleId;
  return <div className="ef-skland-profile">
    <GameArtwork src={imageUrl(base.avatarUrl)} name={name} size={56} />
    <div className="ef-skland-profile-copy">
      <div className="ef-skland-profile-name"><h2>{name}</h2>{snapshot ? <span className="ef-skland-level">Lv.{snapshot.role.level}</span> : null}</div>
      <div className="ef-skland-profile-meta">
        {server ? <span>{server}</span> : null}
        {uid ? <span>UID {uid}</span> : null}
        {snapshot ? <span>{t("SklandDataView.synced")}{new Date(snapshot.fetchedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</span> : null}
      </div>
    </div>
  </div>;
}

export function SklandDataView({ snapshot }: { snapshot: EndfieldSnapshot }) {
  const { t, locale } = useEndfieldLanguage();
  const [search, setSearch] = useState("");
  const [weaponSearch, setWeaponSearch] = useState("");
  const data: DetailRecord = snapshot.details ?? { base: snapshot.role, chars: snapshot.characters, spaceShip: { rooms: snapshot.rooms } };
  const base = record(data.base), sanity = record(data.dungeon), daily = record(data.dailyMission), pass = record(data.bpSystem);
  const allChars = items(data.chars);
  const names = new Map(snapshot.characters.map(char => [char.id, displayText(operatorData(char.id) ?? operatorData(char.name), "name", locale) || char.name]));
  for (const item of allChars) {
    const char = record(item), profile = record(char.charData);
    if (nameOf(char.id) && nameOf(profile.name)) names.set(nameOf(char.id), displayText(operatorData(nameOf(profile.id) || nameOf(profile.name)), "name", locale) || nameOf(profile.name));
  }
  const characters = allChars.filter(item => {
    const char = record(item), profile = record(char.charData), display = operatorData(nameOf(profile.id));
    return [nameOf(profile.name), nameOf(char.name), display?.aliases.join(" ")].join(" ").toLowerCase().includes(search.trim().toLowerCase());
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
    return [w.name, display?.name, display?.aliases.join(" "), w.id].join(" ").toLowerCase().includes(weaponSearch.trim().toLowerCase());
  });
  const activation = quantity(daily.dailyActivation), maxActivation = quantity(daily.maxDailyActivation);
  const currentSanity = quantity(sanity.curStamina), maxSanity = quantity(sanity.maxStamina);
  const unknown = t("SklandDataView.notAvailable");
  const roomNames: Record<string, string> = { "0": t("SklandDataView.controlCenter"), "1": t("SklandDataView.manufacturing"), "2": t("SklandDataView.growth"), "3": t("SklandDataView.reception"), "5": t("SklandDataView.receptionClues") };
  return <div data-skland-data>
    <Tabs defaultValue="overview" className="ef-sync-tabs">
      <CompactTabsList aria-label={t("SklandDataView.sklandDataCategories")}>
        {[["overview", t("SklandDataView.overview")], ["operators", t("SklandDataView.operators")], ["weapons", t("SklandDataView.weapons")], ["inventory", t("SklandDataView.inventory")], ["ship", t("SklandDataView.dijiang")]].map(([id, title]) => <TabsTrigger key={id} value={id}>{title}</TabsTrigger>)}
      </CompactTabsList>
      <TabsContent value="overview">
        <div className="ef-status-grid">
          <StatusCard title={t("SklandDataView.sanity")} current={currentSanity} max={maxSanity}
            description={currentSanity === null || maxSanity === null ? unknown : currentSanity >= maxSanity ? t("SklandDataView.sanityFull") : t("SklandDataView.recovering")} />
          <StatusCard title={t("SklandDataView.dailyMissions")} current={activation} max={maxActivation}
            description={activation === null || maxActivation === null || maxActivation <= 0 ? unknown : activation >= maxActivation ? t("SklandDataView.dailyMissionsComplete") : t("SklandDataView.dailyMissionsIncomplete")} />
          <StatusCard title={t("SklandDataView.battlePass")} current={quantity(pass.curLevel)} max={quantity(pass.maxLevel)}
            description={pass.curLevel == null ? unknown : t("SklandDataView.currentBattlePassLevel")} />
        </div>
        <Section title={t("SklandDataView.characterInformation")}><DataFields value={Object.fromEntries(Object.entries(base).filter(([key]) => !["avatarUrl", "name", "roleId", "serverName"].includes(key)))} names={names} /></Section>
        <Section title={t("SklandDataView.dailyDetails")}><div className="ef-data-columns">
          {data.dungeon ? <Disclosure title={t("SklandDataView.sanityRecovery")}><ProgressDetails label={t("SklandDataView.sanityRecovery")} data={sanity} currentKey="curStamina" maxKey="maxStamina" names={names} /></Disclosure> : null}
          {data.bpSystem ? <Disclosure title={t("SklandDataView.battlePassProgress")}><ProgressDetails label={t("SklandDataView.battlePassProgress")} data={pass} currentKey="curLevel" maxKey="maxLevel" names={names} /></Disclosure> : null}
        </div></Section>
      </TabsContent>
      <TabsContent value="operators"><Section>
        <SearchInput containerClassName="ef-sync-search" label={t("SklandDataView.searchOperators")} placeholder={t("SklandDataView.searchOperators")} value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch("")} clearLabel={t("SklandDataView.clearSearch")} />
        <div className="ef-data-cards">{characters.map((item, i) => {
          const char = record(item), profile = record(char.charData), display = operatorData(nameOf(profile.id) || nameOf(profile.name));
          const weapon = record(char.weapon), weaponProfile = record(weapon.weaponData), weaponDisplay = weaponData(nameOf(weaponProfile.id) || nameOf(weapon.weaponId));
          const name = (displayText(display, "name", locale)) || nameOf(profile.name) || nameOf(char.name) || nameOf(char.id);
          return <article className="ef-data-card" key={nameOf(char.id) || i}>
            <header><OperatorPortrait name={display?.id || name} size={56} elite={quantity(char.evolvePhase ?? char.elite)} /><div><h3>{name}</h3><p>Lv.{nameOf(char.level) || "—"} · E{nameOf(char.evolvePhase ?? char.elite) || "—"}{char.potentialLevel !== undefined ? ` · ${t("SklandDataView.potential")} ${nameOf(char.potentialLevel)}` : ""}</p></div></header>
            <p className="ef-muted">{[record(profile.profession).value, record(profile.property).value, record(profile.rarity).value].map(nameOf).filter(Boolean).join(" · ")}</p>
            {weaponProfile.name || weaponDisplay ? <div className="ef-equipped-weapon"><GameArtwork src={weaponDisplay?.icon || imageUrl(weaponProfile.iconUrl)} name={nameOf(weaponProfile.name)} size={36} /><span>{(displayText(weaponDisplay, "name", locale)) || nameOf(weaponProfile.name)} · Lv.{nameOf(weapon.level) || "—"}</span></div> : null}
            <Disclosure title={t("SklandDataView.operatorSkillsEquipment")}><DataFields value={Object.fromEntries(Object.entries(char).filter(([key]) => key !== "charData"))} names={names} /></Disclosure>
          </article>;
        })}</div>{!characters.length ? <p className="ef-muted">{t("SklandDataView.noMatchingOperators")}</p> : null}
        {snapshot.rosterComplete === false ? <p className="ef-sync-note">{t("SklandDataView.onlyOperatorsMadeVisibleInSklandAreShown")}</p> : null}
      </Section></TabsContent>
      <TabsContent value="weapons"><Section>
        <SearchInput containerClassName="ef-sync-search" label={t("SklandDataView.searchWeapons")} placeholder={t("SklandDataView.searchWeapons")} value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)} onClear={() => setWeaponSearch("")} clearLabel={t("SklandDataView.clearSearch")} />
        <div className="ef-data-cards">{filteredWeapons.map(weapon => {
          const display = weaponData(weapon.id), name = (displayText(display, "name", locale)) || weapon.name || weapon.id;
          return <article className="ef-data-card" key={weapon.key}><header><GameArtwork src={display?.icon || weapon.icon} name={name} size={64} /><div><h3>{name}</h3><p>{display ? `${display.rarity}★ · ` : ""}Lv.{weapon.level ?? "—"}</p></div></header>
            <dl className="ef-data-fields"><div><dt>{t("SklandDataView.breakthrough")}</dt><dd>{weapon.breakthrough ?? "—"}</dd></div><div><dt>{t("SklandDataView.refinement")}</dt><dd>{weapon.refine ?? "—"}</dd></div></dl>
            {weapon.owner ? <p className="ef-muted">{t("SklandDataView.equippedBy")}{weapon.owner}</p> : null}
          </article>;
        })}</div>{!filteredWeapons.length ? <p className="ef-muted">{t("SklandDataView.noMatchingWeapons")}</p> : null}
        {!fullWeapons ? <p className="ef-sync-note">{snapshot.weapons?.items.length ? t("SklandDataView.theWeaponListIsIncompleteAvailableRecordsAreShown") : t("SklandDataView.fullWeaponInventoryIsUnavailableShowingWeaponsEquippedBy")}</p> : null}
      </Section></TabsContent>
      <TabsContent value="inventory"><SklandInventory inventory={snapshot.inventory} /></TabsContent>
      <TabsContent value="ship"><Section>
        {!rooms.length ? <p className="ef-muted">{t("SklandDataView.noShipDataReturned")}</p> : <div className="ef-data-cards">{rooms.map((item, i) => {
          const room = record(item);
          return <article className="ef-data-card" key={nameOf(room.id) || i}><header><h3>{nameOf(room.name) || roomNames[nameOf(room.type)] || t("SklandDataView.facility")} · Lv.{nameOf(room.level)}</h3></header>
            <div className="ef-ship-crew">{sortShipCrewByMood(items(room.chars)).map((item, index) => {
              const char = record(item), id = nameOf(char.charId), op = operatorData(id), name = (displayText(op, "name", locale)) || names.get(id) || id;
              const mood = physicalStrengthPercent(char.physicalStrength) ?? "—";
              const favorability = shipFavorability(char.favorability);
              const level = favorability ? t(favorabilityLevels[favorability.level]) : "";
              const trust = favorability ? (locale !== "en" ? `${favorability.percent}（${level}）` : `${favorability.percent} (${level})`) : "—";
              return <div key={index}><OperatorPortrait name={op?.id || id} size={40} elite={snapshot.characters.find(operator => operator.id === id)?.elite ?? null} /><span>{name}<small>{t("SklandDataView.mood")} {mood} · {t("SklandDataView.trust")} {trust}</small></span></div>;
            })}</div>
            <DataFields value={Object.fromEntries(Object.entries(room).filter(([key]) => !["id", "name", "type", "level", "chars"].includes(key)))} names={names} />
          </article>;
        })}</div>}
        <DataFields value={Object.fromEntries(Object.entries(record(data.spaceShip)).filter(([key]) => key !== "rooms"))} names={names} />
      </Section></TabsContent>
    </Tabs>
  </div>;
}
