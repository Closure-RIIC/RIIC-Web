"use client";

import { FrostCloud } from "./clouds/FrostCloud";
import { GlowCloud } from "./clouds/GlowCloud";
import type { CloudAppearance } from "./agent-appearance-store";

export function CloudAvatar({ appearance, active = false, size = 38 }: { appearance: CloudAppearance; active?: boolean; size?: number }) {
  const Cloud = appearance === "frost-cloud" ? FrostCloud : GlowCloud;
  return <div className="size-full" data-cloud-avatar={appearance} aria-hidden="true">
    <Cloud background={false} animated={active || size >= 64} followPointer={size >= 64} />
  </div>;
}
