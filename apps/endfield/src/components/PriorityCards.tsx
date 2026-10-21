import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { movePriority } from "../scheduling-options";
import { useWorkspace } from "../state";
import { ProductionIcon } from "./GameArtwork";

const categories = ["线索", "干员经验", "武器经验", "培养"];
const names = ["Clues", "Operator EXP", "Weapon EXP", "Growth"];
type Drag = { category: string; target: string; x: number; y: number };

export function PriorityCards({ priority, disabled, onChange }: { priority: string[]; disabled: boolean; onChange: (priority: string[]) => void }) {
  const { t } = useWorkspace();
  const hintId = useId();
  const group = useRef<HTMLOListElement>(null);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; bounds: { category: string; rect: DOMRect }[]; current: Drag } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const label = (category: string) => t(category, names[categories.indexOf(category)] ?? category);
  function reorder(category: string, target: string) {
    if (disabled) return;
    const next = movePriority(priority, category, target);
    if (next === priority) return;
    onChange(next);
    setAnnouncement(t(`${label(category)}已移至第 ${next.indexOf(category) + 1} 优先级。`, `${label(category)} moved to priority ${next.indexOf(category) + 1}.`));
  }
  function start(event: PointerEvent<HTMLButtonElement>, category: string) {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = { category, target: category, x: 0, y: 0 };
    gesture.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, current,
      bounds: Array.from(group.current?.querySelectorAll<HTMLElement>("[data-priority-card]") ?? []).map(element => ({ category: element.dataset.priorityCard!, rect: element.getBoundingClientRect() })),
    };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return;
    const x = event.clientX - current.startX, y = event.clientY - current.startY;
    if (!drag && Math.hypot(x, y) < 6) return;
    const target = current.bounds.find(({ rect }) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)?.category ?? current.current.category;
    current.current = { ...current.current, target, x, y };
    setDrag(current.current);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit) reorder(current.current.category, current.current.target);
  }
  return <>
    <p id={hintId} className="ef-priority-hint">{t("拖动卡片调整顺序，靠前的目标优先满足。也可聚焦卡片后使用方向键排序。", "Drag cards to reorder; earlier goals take priority. You can also focus a card and use the arrow keys.")}</p>
    <ol ref={group} className="ef-priority-cards" aria-label={t("排班目标优先级", "Scheduling priorities")}>
      {priority.map((category, index) => {
        const kind = categories.indexOf(category);
        const dragging = drag?.category === category;
        return <li key={category} data-priority-card={category} data-priority-kind={kind} data-dragging={dragging || undefined} data-drop-target={drag && drag.target === category && !dragging || undefined}
          style={dragging ? { "--ef-drag-x": `${drag.x}px`, "--ef-drag-y": `${drag.y}px` } as CSSProperties : undefined}>
          <button type="button" className="ef-priority-card" disabled={disabled} aria-label={t(`调整${label(category)}优先级，当前第 ${index + 1}`, `Reorder ${label(category)}, priority ${index + 1}`)} aria-describedby={hintId}
            onPointerDown={event => start(event, category)} onPointerMove={move} onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}
            onKeyDown={event => {
              if (event.key === "Escape" && gesture.current) { event.preventDefault(); gesture.current = null; setDrag(null); return; }
              if (gesture.current) return;
              const offset = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : 0;
              const target = event.key === "Home" ? 0 : event.key === "End" ? priority.length - 1 : index + offset;
              if (!offset && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              if (priority[target]) reorder(category, priority[target]);
            }}>
            <span className="ef-priority-rank" aria-hidden>{index + 1}</span><ProductionIcon category={category} size={20} />
            <strong>{label(category)}</strong><GripVertical size={14} aria-hidden />
          </button>
        </li>;
      })}
    </ol>
    <span className="sr-only" role="status">{announcement}</span>
  </>;
}
