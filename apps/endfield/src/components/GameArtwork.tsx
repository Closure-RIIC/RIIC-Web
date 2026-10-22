import { useState, type CSSProperties } from "react";
import { operatorData, weaponData, workbenchArtwork } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import { record, text } from "@riic/endfield-skland/presentation";

export function GameArtwork({ src, name, className = "", size = 48, style }: { src?: string; name: string; className?: string; size?: number; style?: CSSProperties }) {
  const { showImages, ready } = useWorkspace();
  const [failedSource, setFailedSource] = useState<string>();
  return <span className={`ef-artwork ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true">
    {ready && showImages && src && src !== failedSource ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} />
      : <span>{name.slice(0, 1) || "—"}</span>}
  </span>;
}
export function OperatorPortrait({ name, size = 48, elite: explicitElite }: { name: string; size?: number; elite?: number | null }) {
  const { workspace, locale, t } = useWorkspace();
  const display = operatorData(name);
  const elite = explicitElite === undefined ? workspace.operators.find(op => op.name === display?.name)?.elite : explicitElite;
  const stages = [...new Set(display?.skills.flatMap(skill => skill.unlock === null ? [] : [skill.unlock]) ?? [])];
  const progress = elite != null && Number.isInteger(elite) && elite >= 0 && elite <= 4 && stages.length
    ? { unlocked: stages.filter(stage => stage <= elite).length, total: stages.length } : null;
  const label = (locale === "en" ? display?.enName : display?.name) || name;
  const progressLabel = progress ? t(`基建技能已解锁 ${progress.unlocked}/${progress.total} 阶段 · 精英化 ${elite}`,
    `Ship skills: ${progress.unlocked}/${progress.total} stages unlocked · Elite ${elite}`) : "";
  return <span className="ef-operator-portrait" data-rarity={display?.rarity} style={{ width: size, height: size }}
    role={label ? "img" : undefined} aria-label={label ? `${label}${progressLabel ? ` · ${progressLabel}` : ""}` : undefined}
    aria-hidden={!label || undefined} title={progressLabel || label || undefined}>
    <GameArtwork src={display?.icon} name={label} size={size} style={{ width: "100%", height: "100%" }} />
    {progress ? <span className="ef-operator-skill-stage" aria-hidden="true">{progress.unlocked}<small>/{progress.total}</small></span> : null}
  </span>;
}
export function FacilityIcon({ kind, label }: { kind: "center" | "guest" | "grow" | "mfg1" | "mfg2"; label: string }) {
  const entry = workbenchArtwork.facilities[kind === "mfg1" || kind === "mfg2" ? "mfg" : kind];
  return <span className="ef-facility-icon" style={{ backgroundColor: entry.color }}><GameArtwork src={entry.icon} name={label} size={20} /></span>;
}
export function ProductionIcon({ category, size = 22 }: { category: string; size?: number }) {
  const icons: Record<string, keyof typeof workbenchArtwork.resources> = {
    线索: "clues", 干员经验: "operatorExp", 武器经验: "weaponExp", 培养: "growth", 晶植: "crystal", 菌类: "fungus", 矿物: "mineral",
  };
  const entry = workbenchArtwork.resources[icons[category]];
  if (!entry) return null;
  return <GameArtwork src={entry.icon} name={category} size={size}
    className={`ef-production-icon${category === "培养" ? " ef-production-icon--symbol" : ""}`} />;
}
export function EquippedWeapon({ name, compact = false }: { name: string; compact?: boolean }) {
  const { sklandSnapshot, locale, t } = useWorkspace();
  const chars = sklandSnapshot?.details?.chars;
  const character = Array.isArray(chars) ? chars.find(value => {
    const profile = record(record(value).charData);
    return text(profile.name) === name || text(profile.id) === name;
  }) : undefined;
  const weapon = record(record(character).weapon), profile = record(weapon.weaponData);
  const id = text(profile.id) || text(weapon.weaponId) || text(weapon.id);
  const data = weaponData(id);
  const label = (locale === "en" ? data?.enName : data?.name) || text(profile.name);
  if (!label) return null;
  return <span className={`ef-equipped-weapon${compact ? " ef-equipped-weapon--compact" : ""}`} title={`${t("已装备", "Equipped")}: ${label}`}>
    <GameArtwork src={data?.icon || text(profile.iconUrl) || undefined} name={label} size={compact ? 22 : 32} />
    {!compact ? <span>{label}{weapon.level != null ? ` · Lv.${text(weapon.level)}` : ""}</span> : null}
  </span>;
}
export function OperatorChip({ name, showWeapon = true }: { name: string; showWeapon?: boolean }) {
  const { locale } = useWorkspace();
  return <div className="ef-operator-chip"><OperatorPortrait name={name} size={36} /><span>{locale === "en" ? operatorData(name)?.enName || name : name}</span>{showWeapon ? <EquippedWeapon name={name} compact /> : null}</div>;
}
