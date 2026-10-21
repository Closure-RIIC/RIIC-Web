function normalizedIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** MAA pre-actions for a shift are stored in the following plan. */
export function droneStoragePlanIndex(targetShiftIndex: number, planCount: number): number {
  return planCount > 0
    ? normalizedIndex(targetShiftIndex + 1, planCount)
    : targetShiftIndex;
}

/** A plan's MAA pre-action targets the preceding actual shift. */
export function droneTargetShiftIndex(planIndex: number, planCount: number): number {
  return planCount > 0
    ? normalizedIndex(planIndex - 1, planCount)
    : planIndex;
}
