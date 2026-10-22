import type { ReproductionPackage } from "./reproduction-package.ts";
export type QualitySource = { feedbackId?: string; name: string };
export type QualityDraftData = { id: string; revision: number; original: ReproductionPackage; input: ReproductionPackage; sources: QualitySource[]; expiresAt: string };
export type QualityVersion = { id: string; label: string; executableSha256: string; createdAt: string };
export type QualityBatchData = { id: string; status: string; label: string; bundleIds: string[]; createdAt: string; expiresAt: string; cases: { id: string; status: string; sources: QualitySource[]; attempts: { id: string; status: string; startedAt: string; finishedAt: string | null; summary: unknown }[] }[] };
export const QUALITY_CASE_LIMIT = 500;
export const QUALITY_TOTAL_LIMIT = 100 * 1024 * 1024;
export const QUALITY_TIMEOUT_MS = 10 * 60_000;
