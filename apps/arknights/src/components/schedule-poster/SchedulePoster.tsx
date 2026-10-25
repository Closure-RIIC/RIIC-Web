"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { OperatorSlot } from "@/components";
import { manualRoomCapacity, manualRoomForShift } from "@/manual-schedule";
import { operatorPresentationFor } from "@/operatorPortraits";
import { manualEditableRooms, type EditableRoom } from "@/recycling-room";
import { roomVisualFor } from "@/room-visuals";
import { scheduleTextRoomLabel } from "@/schedule-poster-text";
import { PRODUCT_ICON_URLS } from "@/product-assets";
import { dailyProductionValueBreakdown } from "@/daily-production-presentation";
import { posterProduct, posterRoomTitle, ROOM_GROUP } from "@/schedule-poster-model";
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

function posterDay(totalMinutes: number) {
  const day = Math.floor(totalMinutes / 1440);
  return day === 0 ? "" : day === 1 ? "次日" : `第${day + 1}日`;
}

function posterDuration(hours: number) {
  const minutes = Math.round(hours * 60);
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function SchedulePoster(props: Props) {
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
      range: hasStartTime ? `${posterDay(start)}${posterTime(start)}—${posterDay(end)}${posterTime(end)}` : null,
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
  const number = (value: number | undefined) => value === undefined ? "—" : Math.round(value).toLocaleString("zh-CN");
  const detailNumber = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  const productionStats = [
    { label: "龙门币订单", value: values?.lmd.total, icon: PRODUCT_ICON_URLS.lmdOrders, details: [`其中无人机 +${number(values?.lmd.drones)}`] },
    { label: "赤金价值", value: values?.gold.total, icon: PRODUCT_ICON_URLS.gold, details: [
      `其中制造 +${number(values?.gold.natural)} · 无人机 +${number(values?.gold.drones)}`,
      `基建外与隐含赤金 +${number(values ? values.gold.equivalent + values.gold.external : undefined)}`,
    ] },
    { label: "经验", value: values?.experience.total, icon: PRODUCT_ICON_URLS.experience, details: [`其中无人机 +${number(values?.experience.drones)}`] },
    { label: "合成玉", value: values?.orundum.total, icon: PRODUCT_ICON_URLS.orundum, details: [hasOriginiumDrones ? "搓玉无人机增量未计入" : "按搓玉产线瓶颈估算"] },
  ].filter(stat => typeof stat.value === "number" && stat.value !== 0);

  function facility(room: EditableRoom, variant: "control" | "production" | "single" | "pair" | "dorm") {
    const group = ROOM_GROUP[room.kind];
    const visual = roomVisualFor(group);
    const products = shifts.map((_, index) => posterProduct(doc, room, index));
    return <section key={room.id} className={`poster-facility poster-${variant}`} data-poster-room={room.id} style={{ "--facility-color": visual.accent } as CSSProperties}>
      <button className="poster-facility-title" onClick={() => onSelect({ roomId: room.id, shift: 0 })}>
        <span>{posterRoomTitle(room, doc.layout)}</span>
        <span className="poster-facility-ornament" />
        {variant === "production" ? <span className="poster-level" aria-label={`${room.level}级`}>{Array.from({ length: room.level }, (_, i) => <i key={i} />)}</span> : null}
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
              : "待计算";
          const equivalentEfficiency = typeof evaluation?.tradeEquivalentEfficiency === "number"
            ? `${Math.round(evaluation.tradeEquivalentEfficiency * 1000) / 10}%`
            : "待计算";
          const goldEquivalentEfficiency = typeof evaluation?.goldEquivalentEfficiency === "number"
            ? `${Math.round(evaluation.goldEquivalentEfficiency * 1000) / 10}%`
            : "待计算";
          const efficiencyDetail = evaluation
            ? [
                evaluation.specialTradeAnchor
                  ? `${evaluation.specialTradeAnchor.label}：订单倍率 = 特殊订单 ${detailNumber(evaluation.specialTradeAnchor.tradeUnitOutputPerDay)}/普通订单 ${detailNumber(evaluation.specialTradeAnchor.regularTradeOutputPerDay)} = ${evaluation.orderMultiplier}；特殊订单 ${detailNumber(evaluation.specialTradeAnchor.tradeUnitOutputPerDay)}/日${evaluation.specialTradeAnchor.goldUnitOutputPerDay > 0 ? `，赤金锚点 ${detailNumber(evaluation.specialTradeAnchor.goldUnitOutputPerDay)}/日` : ""}`
                  : "常规订单",
                `总效率 = 基础 ${Math.round(evaluation.baseEfficiency * 1000) / 10}% + 纸面技能 ${Math.round(evaluation.skillEfficiency * 1000) / 10}% + 跨设施 ${Math.round(evaluation.globalEfficiency * 1000) / 10}% = ${Math.round(evaluation.totalEfficiency * 1000) / 10}%`,
                `最终效率 = 总效率 × 订单倍率 ${evaluation.orderMultiplier} = ${Math.round(evaluation.finalEfficiency * 1000) / 10}%`,
                `等效效率 = 最终效率 - 基础效率 - 跨设施效率 = ${Math.round((evaluation.tradeEquivalentEfficiency ?? 0) * 1000) / 10}%`,
                `赤金等效 = ${Math.round(evaluation.goldEquivalentEfficiency * 1000) / 10}%（${number(evaluation.goldEquivalentEfficiency * 10_000)}/日）`,
              ].join("；")
            : "纸面效率显示本设施技能；完成计算后显示贸易与赤金等效效率。";
          const timing = timingFor(index);
          const visibleCapacity = variant === "dorm" ? 6 : capacity;
          const memberSlots = Array.from({ length: visibleCapacity }, (_, slot) => {
                const isDormHanger = variant === "dorm" && slot === 5;
                const name = isDormHanger ? doc.presentation.dormHangerOperators[index] ?? undefined : members[slot];
                const autofill = !name && !isDormHanger && slot < capacity && facilityAutofill;
                const presentation = name ? operatorPresentationFor({ name }) : undefined;
                const training = name ? doc.operators.find(operator => operator.name === name) : undefined;
                return <div className="poster-member" key={slot} data-poster-hanger-slot={isDormHanger ? "" : undefined} style={{ "--poster-name-units": Math.max(3, (name ?? (autofill ? "AUTO" : "空位")).split("").reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .62 : 1), 0)) } as CSSProperties}>
                  <div className="poster-operator-art">
                    {room.kind === "training_room" ? <span className="poster-training-role">{slot === 0 ? "专精" : "协助"}</span> : null}
                    <OperatorSlot slot={name ? { name, label: name, portrait: presentation?.portrait, profession: presentation?.operator?.profession } : undefined}
                      elite={training?.elite} eliteBadgeVariant="poster" rarity={presentation?.operator?.rarity} selectionMode tooltipDisabled emptyLabel="空位" autofill={autofill}
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
                  <b>{index + 1}班</b>
                  <div className="poster-shift-meta"><span>{products[index] ? <><img src={products[index]!.icon} alt="" />{products[index]!.label}</> : null}</span></div>
                  <span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span>
                </div>
              </div>
              <div className="poster-production-content">
                <div className="poster-members">{memberSlots}</div>
                <div className="poster-efficiency-panel">
                  <span className="poster-efficiency-pair" title={efficiencyDetail}>
                    <span className="poster-paper-efficiency"><i>纸面</i> {skillEfficiency}</span>
                    {room.kind === "trade_post" ? <span className="poster-equivalent-efficiency">
                      <i>等效</i>
                      <span className="poster-equivalent-values"><span>{equivalentEfficiency}贸易</span><span>+ {goldEquivalentEfficiency}赤金</span></span>
                    </span> : null}
                  </span>
                </div>
              </div>
            </> : <>
              <div className="poster-shift-label"><b>{index + 1}班</b>{["control", "dorm"].includes(variant) ? <span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span> : null}</div>
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
        <div className="poster-identity" style={{ "--poster-title-units": Math.max(8, doc.meta.title.split("").reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .62 : 1), 0)) } as CSSProperties}>
          <div className="poster-title-row"><h1>{doc.meta.title || "未命名作业"}</h1><div className="poster-brand"><img src="/icon.png" alt="本站 LOGO" /><span>可露希尔基建终端</span></div></div>
          <p><span className="poster-cycle">轮换周期 {posterDuration(cycleHours)}</span><span className="poster-author">作者：{doc.meta.author || "未填写"}</span></p>
        </div>
        <div className="poster-output" data-production-ready={Boolean(values)}>
          <div className="poster-output-values">{productionStats.map(stat => <div key={stat.label}><img src={stat.icon} alt="" /><span>{stat.label}<strong>{number(stat.value)}</strong><small>{stat.details.map(detail => <span key={detail}>{detail}</span>)}</small></span></div>)}</div>
        </div>
        <div className="poster-share">{share ? <><QRCodeSVG value={share.url} size={104} level="M" marginSize={2} /><span>{share.code}</span></> : <div className="poster-qr-placeholder">生成作业码后<br />在此显示二维码</div>}</div>
        {doc.presentation.showInstructions ? <div className="poster-instructions" data-dense={doc.meta.instructions.length > 220}><b>说明</b><div>{doc.meta.instructions || "填写使用说明、换班顺序与适用条件。"}</div></div> : null}
        <div className="poster-support-notes" style={{ gridTemplateColumns: `repeat(${shifts.length},minmax(0,1fr))` }}>
          {shifts.map((shift, index) => {
            const drone = doc.layout.rooms.find(room => room.id === shift.droneTargetRoomId);
            const target = shift.fiammettaTarget ? operatorPresentationFor({ name: shift.fiammettaTarget }) : undefined;
            const timing = timingFor(index);
            return <div key={index}><b>{index + 1}班</b><span>{timing.range ? `${timing.range} · ` : ""}{timing.duration}</span><span>无人机 → {drone ? scheduleTextRoomLabel(drone, doc.layout) : "未指定"}</span><span className="poster-fiammetta"><span>菲亚梅塔 →</span>{doc.draft.fiammettaEnabled && shift.fiammettaTarget ? <>{target?.portrait ? <img src={target.portrait} alt="" /> : null}{shift.fiammettaTarget}</> : <span>{doc.draft.fiammettaEnabled ? "未指定" : "未启用"}</span>}</span></div>;
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
