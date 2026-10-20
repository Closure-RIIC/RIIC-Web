import type { BoxSource, OperBoxEntry } from "./types";

export function upgradeSimulationBoxSource(source: BoxSource): "skland" | "maa" {
  return source === "skland" ? "skland" : "maa";
}

function eliteState(entry: OperBoxEntry | undefined): number {
  return entry?.own ? entry.elite : -1;
}

export function hasOperboxEliteStateChange(
  currentBox: readonly OperBoxEntry[],
  trialBox: readonly OperBoxEntry[],
): boolean {
  const currentById = new Map(currentBox.map((entry) => [entry.id, entry]));
  return trialBox.some((entry) => eliteState(entry) !== eliteState(currentById.get(entry.id)));
}
