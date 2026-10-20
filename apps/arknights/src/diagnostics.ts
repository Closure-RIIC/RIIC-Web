export const DIAGNOSTIC_CATEGORIES = ["fault", "solver", "validation", "authentication", "consent", "rate_limit", "not_found"] as const;
export type DiagnosticCategory = typeof DIAGNOSTIC_CATEGORIES[number];
export type DiagnosticRecord = {
  at: string;
  category: DiagnosticCategory;
  fingerprint: string;
  route: string;
  method: string;
  code: string;
  status: number;
  requestId: string;
  diagnosticId?: string;
  durationMs: number;
  release: string;
  clientVersion: string;
  clientSchema: string;
  reason: string;
  causes: string[];
  fields: Array<{path: string; code: string; message: string}>;
};
export type DiagnosticReport = {
  from: string;
  to: string;
  configured: boolean;
  truncated: boolean;
  total: number;
  groups: Array<{fingerprint: string; category: DiagnosticCategory; code: string; route: string; method: string; reason: string; count: number; first: string; last: string}>;
  recent: DiagnosticRecord[];
};
