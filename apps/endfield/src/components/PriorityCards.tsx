import { gameLabel } from "../i18n/game-labels";
import { useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { movePriority } from "../scheduling-options";
import { useWorkspace } from "../state";
import { ProductionIcon } from "./GameArtwork";

const categories = ["线索", "干员经验", "武器经验", "培养"];
type Drag = { category: string; target: string; x: number; y: number };

export type PriorityItem = { id: string; label: string; icon?: ReactNode };

export function PriorityCards({ priority, disabled, onChange, items, hint, ariaLabel }: {
  priority: string[];
  disabled: boolean;
  onChange: (priority: string[]) => void;
  items?: PriorityItem[];
  hint?: string;
  ariaLabel?: string;
}) {
  const { t } = useWorkspace();
  const hintId = useId();
  const group = useRef<HTMLOListElement>(null);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; bounds: { category: string; rect: DOMRect }[]; current: Drag } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list: PriorityItem[] = items ?? categories.map(category => ({
    id: category, label: gameLabel(t, category), icon: <ProductionIcon category={category} size={20} />,
  }));
  const itemOf = (id: string) => list.find(item => item.id === id);
  const label = (id: string) => itemOf(id)?.label ?? id;
  function reorder(category: string, target: string) {
    if (disabled) return;
    const next = movePriority(priority, category, target);
    if (next === priority) return;
    onChange(next);
    setAnnouncement(t("PriorityCards.movedToPriority", { value1: label(category), value2: next.indexOf(category) + 1 }));
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
    <p id={hintId} className="ef-priority-hint">{hint ?? t("PriorityCards.dragCardsToReorderEarlierGoalsTakePriorityYou")}</p>
    <ol ref={group} className="ef-priority-cards" aria-label={ariaLabel ?? t("PriorityCards.schedulingPriorities")}>
      {priority.map((category, index) => {
        const item = itemOf(category);
        const kind = list.findIndex(entry => entry.id === category);
        const dragging = drag?.category === category;
        return <li key={category} data-priority-card={category} data-priority-kind={kind < 0 ? undefined : kind} data-dragging={dragging || undefined} data-drop-target={drag && drag.target === category && !dragging || undefined}
          style={dragging ? { "--ef-drag-x": `${drag.x}px`, "--ef-drag-y": `${drag.y}px` } as CSSProperties : undefined}>
          <button type="button" className="ef-priority-card" disabled={disabled} aria-label={t("PriorityCards.reorderPriority", { value1: label(category), value2: index + 1 })} aria-describedby={hintId}
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
            <span className="ef-priority-rank" aria-hidden>{index + 1}</span>
            {item?.icon ?? <ProductionIcon category={category} size={20} />}
            <strong>{label(category)}</strong><GripVertical size={14} aria-hidden />
          </button>
        </li>;
      })}
    </ol>
    <span className="sr-only" role="status">{announcement}</span>
  </>;
}
