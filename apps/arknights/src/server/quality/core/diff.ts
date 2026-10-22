import { readFileSync } from "node:fs";

import type { CaseDiff, CaseResult } from "./types.ts";
import { describeSummaryDelta } from "./summary.ts";

function operatorNames(operators: unknown): string[] {
  if (!Array.isArray(operators)) return [];
  return operators
    .map((op) => {
      if (typeof op === "string") return op;
      if (op && typeof op === "object" && typeof (op as Record<string, unknown>).name === "string") {
        return (op as Record<string, unknown>).name as string;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name));
}

export function diffCaseResults(a: CaseResult, b: CaseResult): CaseDiff {
  if (!a.fileName || !b.fileName) throw new Error(`case ${a.caseId} 或 ${b.caseId} 缺少 Box 原始文件名。`);
  const sameIdentity = a.source === b.source && a.fileName === b.fileName;
  const compatible = sameIdentity && a.inputSha256 === b.inputSha256 && a.bundleId !== b.bundleId;
  const summaryA = a.summary;
  const summaryB = b.summary;

  const dailyDelta = compatible
    ? describeSummaryDelta(summaryA, summaryB)
    : { trade: null, manu: null, power: null };

  const warningsDelta = { added: [] as string[], removed: [] as string[] };
  if (compatible && summaryA && summaryB) {
    const setA = new Set(summaryA.warnings);
    const setB = new Set(summaryB.warnings);
    warningsDelta.added = summaryB.warnings.filter((w) => !setA.has(w));
    warningsDelta.removed = summaryA.warnings.filter((w) => !setB.has(w));
  }

  const roomChanges: CaseDiff["roomChanges"] = [];
  if (compatible && summaryA && summaryB) {
    const shiftsA = summaryA.shifts;
    const shiftsB = summaryB.shifts;
    const maxShifts = Math.max(shiftsA.length, shiftsB.length);
    for (let shiftIndex = 0; shiftIndex < maxShifts; shiftIndex++) {
      const shiftA = shiftsA[shiftIndex];
      const shiftB = shiftsB[shiftIndex];
      if (!shiftA || !shiftB) continue;
      const roomIds = new Set([
        ...shiftA.room_lines.map((line) => line.room_id),
        ...shiftB.room_lines.map((line) => line.room_id),
      ]);
      for (const roomId of roomIds) {
        const lineA = shiftA.room_lines.find((line) => line.room_id === roomId);
        const lineB = shiftB.room_lines.find((line) => line.room_id === roomId);
        const operatorsA = lineA ? operatorNamesFromSaved(roomId, shiftIndex, a) : [];
        const operatorsB = lineB ? operatorNamesFromSaved(roomId, shiftIndex, b) : [];
        if (JSON.stringify(operatorsA) === JSON.stringify(operatorsB)) continue;
        roomChanges.push({ room_id: roomId, shiftIndex, operatorsA, operatorsB });
      }
    }
  }

  return {
    caseId: a.caseId,
    label: a.fileName,
    source: sameIdentity ? a.source ?? null : null,
    fileName: sameIdentity ? a.fileName : null,
    inputSha256A: a.inputSha256,
    inputSha256B: b.inputSha256,
    compatible,
    bundleA: a.bundleId,
    bundleB: b.bundleId,
    resultA: a,
    resultB: b,
    dailyDelta,
    warningsDelta,
    roomChanges,
  };
}

const ROOM_ID_TO_MAA_KIND: Record<string, string> = {
  trade: "trading",
  manu: "manufacture",
  power: "power",
  control: "control",
  dorm: "dormitory",
  meeting: "meeting",
  office: "hire",
  workshop: "processing",
};

function roomIdToMaaReference(roomId: string): { kind: string; index: number } | null {
  const match = /^([a-z_]+)_(\d+)$/.exec(roomId);
  if (!match) return null;
  const base = match[1].replace(/_\d+$/, "");
  const kind = ROOM_ID_TO_MAA_KIND[base];
  if (!kind) return null;
  return { kind, index: Number(match[2]) - 1 };
}

function operatorNamesFromSaved(roomId: string, shiftIndex: number, result: CaseResult): string[] {
  const serveResponse = result.savedFiles.serveResponse;
  if (!serveResponse) throw new Error(`case ${result.caseId} 缺少保存的 solver 响应，无法比较房间成员。`);
  try {
    const raw = readFileSync(serveResponse, "utf-8");
    const response = JSON.parse(raw) as Record<string, unknown>;
    const payload = (response.result ?? {}) as Record<string, unknown>;
    const maa = payload.maa as Record<string, unknown> | undefined;
    if (!maa) throw new Error(`case ${result.caseId} 的 solver 响应缺少 MAA 排班。`);
    const plans = Array.isArray(maa.plans) ? maa.plans : [];
    const plan = plans[shiftIndex] as Record<string, unknown> | undefined;
    const rooms = (plan?.rooms ?? {}) as Record<string, unknown>;
    const reference = roomIdToMaaReference(roomId);
    if (!reference) return [];
    const rawRoomList: unknown = rooms[reference.kind];
    const roomList = Array.isArray(rawRoomList) ? rawRoomList : [];
    const room = roomList[reference.index] as Record<string, unknown> | undefined;
    return operatorNames(room?.operators);
  } catch (error) {
    throw new Error(`case ${result.caseId} 的 solver 响应不可读取，无法比较房间成员。`, { cause: error });
  }
}
