"use client";
import type { AppLocale } from "@riic/contracts/locale";
import { useGameCatalog } from "@/i18n/game-data-client";
import { localizedOperatorName } from "@/i18n/game-data";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_schedule_poster_SchedulePoster.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_schedule_poster_SchedulePoster");


import { useEffect, useRef, useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { OperatorSlot } from "@/components";
import { manualRoomCapacity, manualRoomForShift } from "@/manual-schedule";
import { operatorPresentationFor } from "@/operatorPortraits";
import { manualEditableRooms, type EditableRoom } from "@/recycling-room";
import { roomVisualFor } from "@/room-visuals";
import { PRODUCT_ICON_URLS } from "@/product-assets";
import { dailyProductionValueBreakdown } from "@/daily-production-presentation";
import { posterProduct, posterRoomTitle, posterDisplayTitle, ROOM_GROUP } from "@/schedule-poster-model";
import { DEFAULT_MANUAL_SHIFT_START_TIME } from "@/manual-schedule-config";
import type { SchedulePosterDocument } from "@/schedule-poster-document";
import type { ManualPlanResult } from "@/manual-plan-result";

export type PosterTarget = { roomId: string; shift: number; slot?: number; presentationOnly?: "dorm-hanger" };
type Props = {
  document: SchedulePosterDocument;
  result: ManualPlanResult | null;
  background: string | null;
  share: { code: string; url: string } | null;
  onSelect: (target: PosterTarget) => void;
};

function posterTime(totalMinutes: number) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function posterDay(totalMinutes: number, rawLocale: AppLocale) {
  const day = Math.floor(totalMinutes / 1440);
  return day === 0 ? "" : day === 1 ? rawText.text(rawLocale, "nextDay") : rawText.text(rawLocale, "dayNumber", { day: day + 1 });
}

function posterDuration(hours: number) {
  const minutes = Math.round(hours * 60);
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function SchedulePoster(props: Props) {
  const rawLocale = useRawLocale();
  const gameCatalog = useGameCatalog();
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.65);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setScale(entries[0]!.contentRect.width / 1920));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { document: doc, result, background, share, onSelect } = props;
  const shifts = doc.draft.shifts;
  const hasStartTime = Boolean(doc.draft.startTime);
  const startTime = doc.draft.startTime || DEFAULT_MANUAL_SHIFT_START_TIME;
  const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const cycleHours = shifts.reduce((sum, shift) => sum + shift.durationHours, 0);
  const timingFor = (index: number) => {
    const elapsed = shifts.slice(0, index).reduce((sum, shift) => sum + shift.durationHours * 60, 0);
    const start = startMinutes + elapsed;
    const end = start + shifts[index]!.durationHours * 60 - 1;
    return {
      range: hasStartTime ? `${posterDay(start, rawLocale)}${posterTime(start)}—${posterDay(end, rawLocale)}${posterTime(end)}` : null,
      duration: posterDuration(shifts[index]!.durationHours),
    };
  };
  const visible = manualEditableRooms(doc.layout).filter(room => !doc.presentation.hiddenFacilities.includes(room.id));
  const control = visible.find(room => room.kind === "control_center");
  const production = visible.filter(room => room.kind === "trade_post" || room.kind === "factory");
  const singles = visible.filter(room => ["power_plant", "office", "workshop"].includes(room.kind)).sort((a, b) => ["power_plant", "office", "workshop"].indexOf(a.kind) - ["power_plant", "office", "workshop"].indexOf(b.kind));
  const pairs = visible.filter(room => ["meeting_room", "training_room", "recycling"].includes(room.kind));
  const dorm = visible.find(room => room.kind === "dormitory");
  const total = result?.rotation.daily.production;
  const values = total ? dailyProductionValueBreakdown(total, result?.rotation.daily.drone_production) : null;
  const hasOriginiumDrones = shifts.some(shift => {
    const base = doc.layout.rooms.find(room => room.id === shift.droneTargetRoomId);
    const product = base ? manualRoomForShift(base, shift.rooms[base.id]).product : undefined;
    return product && ("trade" in product ? product.trade.order === "originium" : product.factory.recipe === "originium");
  });
  const number = (value: number | undefined) => value === undefined ? "—" : Math.round(value).toLocaleString(rawLocale);
  const detailNumber = (value: number) => new Intl.NumberFormat(rawLocale, { maximumFractionDigits: 2 }).format(value);
  const productionStats = [
    { label: rawText.text(rawLocale, "lmdOrders"), value: values?.lmd.total, icon: PRODUCT_ICON_URLS.lmdOrders, details: [rawText.text(rawLocale, "droneContribution", { count: number(values?.lmd.drones) })] },
    { label: rawText.text(rawLocale, "goldValue"), value: values?.gold.total, icon: PRODUCT_ICON_URLS.gold, details: [
      rawText.text(rawLocale, "goldSources", { natural: number(values?.gold.natural), drones: number(values?.gold.drones) }),
      rawText.text(rawLocale, "externalGold", { count: number(values ? values.gold.equivalent + values.gold.external : undefined) }),
    ] },
    { label: rawText.text(rawLocale, "experience"), value: values?.experience.total, icon: PRODUCT_ICON_URLS.experience, details: [rawText.text(rawLocale, "droneContribution", { count: number(values?.experience.drones) })] },
    { label: rawText.text(rawLocale, "orundum"), value: values?.orundum.total, icon: PRODUCT_ICON_URLS.orundum, details: [hasOriginiumDrones ? rawText.text(rawLocale, "noOriginiumDrones") : rawText.text(rawLocale, "originiumBottleneck")] },
  ].filter(stat => typeof stat.value === "number" && stat.value !== 0);

  function facility(room: EditableRoom, variant: "control" | "production" | "single" | "pair" | "dorm") {
    const group = ROOM_GROUP[room.kind];
    const visual = roomVisualFor(group);
    const products = shifts.map((_, index) => posterProduct(doc, room, index, rawLocale));
    return <section key={room.id} className={`poster-facility poster-${variant}`} data-poster-room={room.id} style={{ "--facility-color": visual.accent } as CSSProperties}>
      <button className="poster-facility-title" onClick={() => onSelect({ roomId: room.id, shift: 0 })}>
        <span>{posterRoomTitle(room, doc.layout, rawLocale)}</span>
        <span className="poster-facility-ornament" />
        {variant === "production" ? <span className="poster-level" aria-label={rawText.text(rawLocale, "level", { level: room.level })}>{Array.from({ length: room.level }, (_, i) => <i key={i} />)}</span> : null}
      </button>
      <div className="poster-shift-stack" style={{ gridTemplateRows: `repeat(${shifts.length}, minmax(0,1fr))` }}>
        {shifts.map((shift, index) => {
          const assignment = shift.rooms[room.id];
          const members = assignment?.operators ?? [];
          const facilityAutofill = assignment?.autofill === true || Boolean(assignment?.autofillSlots?.length);
          const capacity = variant === "control" ? 5 : manualRoomCapacity(room);
          const evaluation = result?.roomsByShift[index]?.find(item => item.roomId === room.id);
          const skillEfficiency = evaluation
            ? `${Math.round(evaluation.skillEfficiency * 1000) / 10}%`
            : doc.efficiencyMode === "manual" && shift.rooms[room.id]?.manualSkillEfficiencyPct !== undefined
              ? `${shift.rooms[room.id]?.manualSkillEfficiencyPct}%`
              : rawText.text(rawLocale, "waiting");
          const equivalentEfficiency = typeof evaluation?.tradeEquivalentEfficiency === "number"
            ? `${Math.round(evaluation.tradeEquivalentEfficiency * 1000) / 10}%`
            : rawText.text(rawLocale, "waiting");
          const goldEquivalentEfficiency = typeof evaluation?.goldEquivalentEfficiency === "number"
            ? `${Math.round(evaluation.goldEquivalentEfficiency * 1000) / 10}%`
            : rawText.text(rawLocale, "waiting");
          const efficiencyDetail = evaluation
            ? [
                evaluation.specialTradeAnchor
                  ? rawText.text(rawLocale, "specialOrder", { label: evaluation.specialTradeAnchor.label, special: detailNumber(evaluation.specialTradeAnchor.tradeUnitOutputPerDay), regular: detailNumber(evaluation.specialTradeAnchor.regularTradeOutputPerDay), multiplier: evaluation.orderMultiplier, daily: detailNumber(evaluation.specialTradeAnchor.tradeUnitOutputPerDay), goldNote: evaluation.specialTradeAnchor.goldUnitOutputPerDay > 0 ? rawText.text(rawLocale, "goldAnchor", { daily: detailNumber(evaluation.specialTradeAnchor.goldUnitOutputPerDay) }) : "" })
                  : rawText.text(rawLocale, "regularOrders"),
                rawText.text(rawLocale, "totalEfficiency", { base: Math.round(evaluation.baseEfficiency * 1000) / 10, skill: Math.round(evaluation.skillEfficiency * 1000) / 10, global: Math.round(evaluation.globalEfficiency * 1000) / 10, total: Math.round(evaluation.totalEfficiency * 1000) / 10 }),
                rawText.text(rawLocale, "finalEfficiency", { multiplier: evaluation.orderMultiplier, final: Math.round(evaluation.finalEfficiency * 1000) / 10 }),
                rawText.text(rawLocale, "tradeEquivalent", { value: Math.round((evaluation.tradeEquivalentEfficiency ?? 0) * 1000) / 10 }),
                rawText.text(rawLocale, "goldEquivalent", { efficiency: Math.round(evaluation.goldEquivalentEfficiency * 1000) / 10, daily: number(evaluation.goldEquivalentEfficiency * 10_000) }),
              ].join("；")
            : rawText.text(rawLocale, "explainEfficiency");
          const timing = timingFor(index);
          const visibleCapacity = variant === "dorm" ? 6 : capacity;
          const memberSlots = Array.from({ length: visibleCapacity }, (_, slot) => {
                const isDormHanger = variant === "dorm" && slot === 5;
                const name = isDormHanger ? doc.presentation.dormHangerOperators[index] ?? undefined : members[slot];
                const autofill = !name && !isDormHanger && slot < capacity && facilityAutofill;
                const presentation = name ? operatorPresentationFor({ name }) : undefined;
                const training = name ? doc.operators.find(operator => operator.name === name) : undefined;
                return <div className="poster-member" key={slot} data-poster-hanger-slot={isDormHanger ? "" : undefined} style={{ "--poster-name-units": Math.max(3, (name ?? (autofill ? "AUTO" : rawText.text(rawLocale, "emptySlot"))).split("").reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .62 : 1), 0)) } as CSSProperties}>
                  <div className="poster-operator-art">
                    {room.kind === "training_room" ? <span className="poster-training-role">{slot === 0 ? rawText.text(rawLocale, "mastery") : rawText.text(rawLocale, "trainer")}</span> : null}
                    <OperatorSlot slot={name ? { name, label: name, portrait: presentation?.portrait, profession: presentation?.operator?.profession } : undefined}
                      elite={training?.elite} eliteBadgeVariant="poster" rarity={presentation?.operator?.rarity} selectionMode tooltipDisabled emptyLabel={rawText.text(rawLocale, "emptySlot")} autofill={autofill}
                      onActivate={isDormHanger
                        ? () => onSelect({ roomId: room.id, shift: index, slot, presentationOnly: "dorm-hanger" })
                        : slot < capacity ? () => onSelect({ roomId: room.id, shift: index, slot }) : undefined} />
                  </div>
                </div>;
              });
          return <div className="poster-shift" key={index} data-poster-shift={index}>
            {variant === "production" ? <>
              <div className="poster-production-heading">
                <div className="poster-shift-label">
                  <b>{rawText.rich(rawLocale, "shift", { part1: richValue((index + 1)) })}</b>
                  <div className="poster-shift-meta"><span>{products[index] ? <><img src={products[index]!.icon} alt="" />{products[index]!.label}</> : null}</span></div>
                  <span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span>
                </div>
              </div>
              <div className="poster-production-content">
                <div className="poster-members">{memberSlots}</div>
                <div className="poster-efficiency-panel">
                  <span className="poster-efficiency-pair" title={efficiencyDetail}>
                    <span className="poster-paper-efficiency"><i>{rawText.text(rawLocale, "skill")}</i> {skillEfficiency}</span>
                    {room.kind === "trade_post" ? <span className="poster-equivalent-efficiency">
                      <i>{rawText.text(rawLocale, "equivalent")}</i>
                      <span className="poster-equivalent-values"><span>{rawText.rich(rawLocale, "trading", { part1: richValue((equivalentEfficiency)) })}</span><span>{rawText.rich(rawLocale, "pureGold", { part1: richValue((goldEquivalentEfficiency)) })}</span></span>
                    </span> : null}
                  </span>
                </div>
              </div>
            </> : <>
              <div className="poster-shift-label"><b>{rawText.rich(rawLocale, "shift", { part1: richValue((index + 1)) })}</b>{["control", "dorm"].includes(variant) ? <span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span> : null}</div>
              <div className="poster-members">{memberSlots}</div>
            </>}
          </div>;
        })}
      </div>
    </section>;
  }

  return <div className="poster-preview" ref={host} style={{ height: 1080 * scale }}>
    <div className="schedule-poster" data-schedule-poster data-shift-count={shifts.length} style={{ transform: `scale(${scale})` }}>
      <div className="poster-background" style={{ backgroundColor: doc.presentation.backgroundColor, backgroundImage: background ? `url(${JSON.stringify(background)})` : undefined }} />
      <header className={`poster-header${doc.presentation.showInstructions ? "" : " poster-header-no-instructions"}`}>
        <div className="poster-identity" style={{ "--poster-title-units": Math.max(8, posterDisplayTitle(doc, rawLocale).split("").reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .62 : 1), 0)) } as CSSProperties}>
          <div className="poster-title-row"><h1>{posterDisplayTitle(doc, rawLocale) || rawText.text(rawLocale, "untitled")}</h1><div className="poster-brand"><img src="/icon.png" alt={rawText.text(rawLocale, "siteLogo")} /><span>{rawText.text(rawLocale, "closureInfrastructureTerminal")}</span></div></div>
          <p><span className="poster-cycle">{rawText.rich(rawLocale, "rotationCycle", { part1: richValue((posterDuration(cycleHours))) })}</span><span className="poster-author">{rawText.rich(rawLocale, "author", { part1: richValue((doc.meta.author || rawText.text(rawLocale, "notProvided"))) })}</span></p>
        </div>
        <div className="poster-output" data-production-ready={Boolean(values)}>
          <div className="poster-output-values">{productionStats.map(stat => <div key={stat.label}><img src={stat.icon} alt="" /><span>{stat.label}<strong>{number(stat.value)}</strong><small>{stat.details.map(detail => <span key={detail}>{detail}</span>)}</small></span></div>)}</div>
        </div>
        <div className="poster-share">{share ? <><QRCodeSVG value={share.url} size={104} level="M" marginSize={2} /><span>{share.code}</span></> : <div className="poster-qr-placeholder">{rawText.rich(rawLocale, "generateAScheduleCodeToDisplayItsQrCode", { part1: richValue((<br />)) })}</div>}</div>
        {doc.presentation.showInstructions ? <div className="poster-instructions" data-dense={doc.meta.instructions.length > 220}><b>{rawText.text(rawLocale, "notes")}</b><div>{doc.meta.instructions || rawText.text(rawLocale, "instructionsPlaceholder")}</div></div> : null}
        <div className="poster-support-notes" style={{ gridTemplateColumns: `repeat(${shifts.length},minmax(0,1fr))` }}>
          {shifts.map((shift, index) => {
            const drone = doc.layout.rooms.find(room => room.id === shift.droneTargetRoomId);
            const target = shift.fiammettaTarget ? operatorPresentationFor({ name: shift.fiammettaTarget }) : undefined;
            const timing = timingFor(index);
            return <div key={index}><b>{rawText.rich(rawLocale, "shift", { part1: richValue((index + 1)) })}</b><span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span><span>{rawText.rich(rawLocale, "drones", { part1: richValue((drone ? posterRoomTitle(drone, doc.layout, rawLocale) : rawText.text(rawLocale, "unspecified"))) })}</span><span className="poster-fiammetta"><span>{rawText.text(rawLocale, "fiammetta")}</span>{doc.draft.fiammettaEnabled && shift.fiammettaTarget ? <>{target?.portrait ? <img src={target.portrait} alt="" /> : null}{localizedOperatorName(shift.fiammettaTarget, rawLocale, gameCatalog)}</> : <span>{doc.draft.fiammettaEnabled ? rawText.text(rawLocale, "unspecified") : rawText.text(rawLocale, "notEnabled")}</span>}</span></div>;
          })}
        </div>
      </header>
      <main className="poster-body">
        {control ? facility(control, "control") : <div />}
        <div className="poster-production-zone">{[production.slice(0, 3), production.slice(3)].map((row, index) => <div className="poster-production-row" key={index} data-room-count={row.length} style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, minmax(0,1fr))` }}>{row.map(room => facility(room, "production"))}</div>)}</div>
        <div className="poster-support-zone">
          <div className="poster-support-row" style={{ gridTemplateColumns: `repeat(${Math.max(1, singles.length)}, minmax(0,1fr))` }}>{singles.map(room => facility(room, "single"))}</div>
          <div className="poster-support-row" style={{ gridTemplateColumns: `repeat(${Math.max(1, pairs.length)}, minmax(0,1fr))` }}>{pairs.map(room => facility(room, "pair"))}</div>
          {dorm ? facility(dorm, "dorm") : <div />}
        </div>
      </main>
    </div>
  </div>;
}
