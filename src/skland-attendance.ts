export interface SklandAttendanceView {
  uid: string;
  date: string;
  hasToday: boolean;
  signedNow: boolean;
  awards: Array<{ name: string; count: number }>;
}
export function shanghaiAttendanceDate(milliseconds = Date.now()): string {
  return new Date(milliseconds + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function attendanceFromStatus(uid: string, status: {
  currentTs: string;
  records: Array<{ ts: string; resourceId: string; count: number }>;
  resourceInfoMap: Record<string, { name: string }>;
}): SklandAttendanceView {
  const timestamp = Number(status.currentTs) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Array.isArray(status.records)) throw new Error("Invalid attendance status");
  const date = shanghaiAttendanceDate(timestamp);
  const today = status.records.filter(r => Number.isFinite(Number(r.ts)) && shanghaiAttendanceDate(Number(r.ts) * 1000) === date);
  return { uid, date, hasToday: today.length > 0, signedNow: false, awards: today.flatMap(r => {
    const name = status.resourceInfoMap?.[r.resourceId]?.name;
    return typeof name === "string" && Number.isFinite(r.count) && r.count >= 0 ? [{ name: name.slice(0, 100), count: r.count }] : [];
  }).slice(0, 20) };
}
