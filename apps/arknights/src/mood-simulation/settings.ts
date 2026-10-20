import { defaultMoodSettings, type MoodSettings } from "./types.ts";

export { MOOD_STORAGE_KEY } from "../manual-schedule-config.ts";
export function pruneSettings(settings: MoodSettings, shiftCount: number, names: ReadonlySet<string>, rooms: ReadonlySet<string>): MoodSettings {
  return {...settings,
    fiammetta:Object.fromEntries(Object.entries(settings.fiammetta).filter(([key]) => Number(key)<shiftCount)),
    idle:Object.fromEntries(Object.entries(settings.idle).filter(([key]) => {
      const [cycle,shift,...name]=key.split(":");
      return Number(cycle)<settings.cycles && Number(shift)<shiftCount && names.has(name.join(":"));
    }).map(([key,rule]) => [key,{enabled:rule.enabled,
      ...(rule.target && names.has(rule.target) ? {target:rule.target}:{}),
      ...(rule.dorm && rooms.has(rule.dorm) ? {dorm:rule.dorm}:{})}])),
  };
}
export function readSettings(raw: string | null, signature: string): MoodSettings {
  try {
    const saved=JSON.parse(raw ?? "null");
    if (saved?.signature !== signature || saved.settings?.version !== 1) return defaultMoodSettings();
    const value=saved.settings;
    if (!Number.isInteger(value.cycles) || value.cycles<1 || value.cycles>7 ||
        typeof value.idleEnabled !== "boolean" || !value.fiammetta || !value.idle) return defaultMoodSettings();
    const out=defaultMoodSettings();
    out.cycles=value.cycles;out.idleEnabled=value.idleEnabled;
    for (const [key,r] of Object.entries(value.fiammetta)) {
      const row=r as Record<string,unknown>;
      if (Number.isInteger(Number(key)) && Number(key)>=0 && typeof row?.enabled === "boolean" &&
          typeof row.wait === "boolean" && ["specified","previous","auto"].includes(String(row.mode)))
        out.fiammetta[Number(key)]={enabled:row.enabled,wait:row.wait,mode:row.mode as "specified"|"previous"|"auto"};
    }
    for (const [key,r] of Object.entries(value.idle)) {
      const row=r as Record<string,unknown>;
      if (/^\d+:\d+:.+$/.test(key) && typeof row?.enabled === "boolean")
        out.idle[key]={enabled:row.enabled,...(typeof row.target === "string" ? {target:row.target}:{}),...(typeof row.dorm === "string" ? {dorm:row.dorm}:{})};
    }
    return out;
  } catch {return defaultMoodSettings();}
}
