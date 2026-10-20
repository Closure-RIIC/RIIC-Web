import { adminPageClass, AdminPageHeader } from "./admin-page";

import { AdminSolverMetrics } from "./users/solver-metrics-client";
import { SolverVersion } from "./solver-version";
import { DiagnosticsPanel } from "./diagnostics-panel";


export default function AdminPage({ plannerReady, solverFingerprint }: { plannerReady: boolean; solverFingerprint: import("@/types").SolverPingFingerprint | null }) {

  return (
    <main id="admin-content" className={adminPageClass}>
      <AdminPageHeader title="overview" description="overviewHint" />
      <AdminSolverMetrics />

      <SolverVersion
        plannerReady={plannerReady}
        solverFingerprint={solverFingerprint}
      />
      <DiagnosticsPanel />
    </main>
  );
}
