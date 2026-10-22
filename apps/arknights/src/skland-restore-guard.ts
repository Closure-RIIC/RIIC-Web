export interface SklandRestoreGuard {
  begin(): number;
  current(): number;
  isCurrent(generation: number): boolean;
  canApplySummary(generation: number): boolean;
  acceptFull(generation: number): boolean;
}

export function createSklandRestoreGuard(): SklandRestoreGuard {
  let currentGeneration = 0;
  let fullGeneration = 0;
  return {
    begin() {
      currentGeneration += 1;
      fullGeneration = 0;
      return currentGeneration;
    },
    current() {
      return currentGeneration;
    },
    isCurrent(generation) {
      return generation === currentGeneration;
    },
    canApplySummary(generation) {
      return generation === currentGeneration && fullGeneration !== generation;
    },
    acceptFull(generation) {
      if (generation !== currentGeneration) return false;
      fullGeneration = generation;
      return true;
    },
  };
}
