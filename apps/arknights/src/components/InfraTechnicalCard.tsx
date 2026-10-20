import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { roomVisualFor } from "@/room-visuals";
import { roomGridTone } from "@/schedule-view-presentation";

export function InfraTechnicalCard({
  group,
  className,
  children,
  dataSlot,
  showEmblem = true,
}: {
  group: string;
  className?: string;
  children: ReactNode;
  dataSlot?: string;
  showEmblem?: boolean;
}) {
  const visual = roomVisualFor(group);
  const gridTone = roomGridTone(group);
  const style = {
    "--room-accent": visual.accent,
    "--room-level": visual.level,
    "--room-grid-color": gridTone.color,
    "--room-grid-opacity": gridTone.opacity,
    "--room-grid-fade-start": gridTone.fadeStart,
  } as CSSProperties;

  return (
    <article
      className={cn(
        "infra-room-surface relative overflow-hidden px-4 py-4 text-white",
        className
      )}
      data-infra-technical-card
      data-room-group={group}
      data-slot={dataSlot}
      style={style}
    >
      {showEmblem ? (
        <div
          className="infra-room-emblem pointer-events-none absolute inset-0 bg-left bg-no-repeat"
          style={{
            backgroundImage: `url(${visual.background})`,
            backgroundPosition: "-18px center",
            backgroundSize: "auto 100%",
          }}
          aria-hidden="true"
        />
      ) : null}
      <div className="relative z-10 h-full">{children}</div>
    </article>
  );
}

export function InfraTechnicalHeading({
  icon,
  children,
  titleId,
}: {
  icon: ReactNode;
  children: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <span className="h-5 w-1 shrink-0 bg-[var(--room-accent)]" aria-hidden="true" data-infra-heading-accent />
      <span className="text-[var(--room-accent)]">{icon}</span>
      <h3 id={titleId} className="text-xs font-medium tracking-wide text-white/66">
        {children}
      </h3>
    </div>
  );
}
