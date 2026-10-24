import { DEFAULT_OPTIONS, type Options } from "@riic/endfield-solver/model.mjs";

/** Fill absent rooms for local simulation without upgrading existing facilities. */
export function completeMissingFacilities(options: Options): Options {
  const levels = { ...options.levels };
  for (const key of Object.keys(levels) as (keyof typeof levels)[]) {
    if (levels[key] === 0) levels[key] = DEFAULT_OPTIONS.levels[key];
  }
  return withFacilityLevels(options, levels);
}

/** Preserve production choices; only reduce plot counts when capacity shrinks. */
export function withFacilityLevels(options: Options, levels: Options["levels"]): Options {
  if ((Object.keys(levels) as (keyof typeof levels)[]).every(key => options.levels[key] === levels[key])) return options;
  let remaining = levels.grow * 3;
  const grow = Object.fromEntries(["晶植", "菌类", "矿物"].map(kind => {
    const count = Math.min(options.grow[kind] ?? 0, remaining);
    remaining -= count;
    return [kind, count];
  }));
  return { ...options, levels: { ...levels }, grow };
}

export function movePriority(priority: string[], category: string, target: string): string[] {
  const from = priority.indexOf(category), to = priority.indexOf(target);
  if (from < 0 || to < 0 || from === to) return priority;
  const next = [...priority];
  next.splice(from, 1);
  next.splice(to, 0, category);
  return next;
}
