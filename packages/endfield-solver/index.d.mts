export interface Operator { name: string; elite: number }
export interface Options {
  mfg: string; levels: { center: number; mfg1: number; mfg2: number; grow: number; guest: number };
  grow: Record<string, number>; priority: string[]; assist: boolean; budget: number; time: number;
}
export interface Workspace { version: 1; operators: Operator[]; options: Options; manual?: Assignment[] }
export interface Assignment { key: string; slots: number; hour: number; a: string[]; b: string[] }
export interface Mood { consumption: number; recovery: number; stable: boolean }
export type SolverStage = "preparing" | "searching" | "verifying";
export interface SolverProgress { stage: SolverStage; elapsedMs: number }
export interface Result {
  revision: string; elapsedMs: number;
  status: { searchComplete: boolean; stopReason: string; centersVisited: number; centersTotal: number; nodes: number; approximations: string[]; gaps: { cat: string; reason: string; detail?: string }[] };
  verification: { ok: boolean; errors: string[] }; scores: Record<string, number>;
  center: { hour: number; a: string[]; b: string[]; recoveryA: number; recoveryB: number } | null;
  rooms: { key: string; category: string; single: boolean; hour: number; a: string[]; b: string[]; value: number;
    bonusA: number | null; bonusB: number | null;
    converged: boolean; days: number; daily: number[]; moodA: Mood | null; moodB: Mood | null; workHours: number | null; restHours: number | null;
    assist: { points: number; shift: string; cycle: string[][] } | null }[];
}
export const catalog: { id: string; name: string; enName: string; rarity: number; profession: string; skills: { name: string; room: string; unlock: number; description: string; effectKey: string }[] }[];
export const nonSchedulableOperators: { id: string; name: string }[];
export const SOLVER_REVISION: string;
export const STORAGE_KEY: string;
export const CATEGORIES: string[];
export const DEFAULT_OPTIONS: Options;
export function parseRoster(input: unknown): Operator[];
export function validateOptions(options: Options): unknown;
export function parseWorkspace(text: string): Workspace;
export function solve(input: Pick<Workspace, "operators" | "options">, onProgress?: (progress: SolverProgress) => void): Result;
export function manualTemplate(options: Options): Assignment[];
export function evaluateManual(input: Pick<Workspace, "operators" | "options">, assignments: Assignment[], onProgress?: (progress: SolverProgress) => void): Result;
