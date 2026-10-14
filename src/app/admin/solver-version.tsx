"use client";
import { useTranslations } from "use-intl";

import { ChevronDown } from "lucide-react";

import type { SolverPingFingerprint } from "@/types";

function FingerprintValue({ value, dataAttribute, unavailable }: { value: string | number | null; dataAttribute?: string; unavailable: string }) {
  return (
    <code
      className="mt-1 block break-all font-mono text-xs leading-5 text-foreground"
      {...(dataAttribute ? { [dataAttribute]: value ?? "unavailable" } : {})}
    >
      {value ?? unavailable}
    </code>
  );
}

export function SolverVersion({
  plannerReady,
  solverFingerprint,
}: {
  plannerReady: boolean;
  solverFingerprint: SolverPingFingerprint | null;
}) {
  const intl = useTranslations();

  const unavailable = intl("app_admin_solver_version.unavailable");
  const executableSha256 = solverFingerprint?.pong
    ? solverFingerprint.solverExecutableSha256
    : null;

  return (
    <section
      id="solver-version"
      className="scroll-mt-24 overflow-hidden rounded-xl border bg-card"
      data-admin-solver-status
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{intl("app_admin_solver_version.solverVersion")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{intl("app_admin_solver_version.buildIdentityAndProtocolCapabilitiesCurrentlyRunningOnThe")}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${plannerReady ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>
          <span className={`size-1.5 rounded-full ${plannerReady ? "bg-emerald-500" : "bg-destructive"}`} aria-hidden="true" />
          {plannerReady ? (intl("app_admin_solver_version.running")) : (intl("app_admin_solver_version.notReady"))}
        </span>
      </header>

      <div className="px-5 py-5 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Linux ELF SHA-256</p>
        <code
          className="mt-2 block break-all rounded-xl bg-muted/55 px-4 py-3 font-mono text-xs leading-5 ring-1 ring-foreground/5"
          data-solver-fingerprint={executableSha256 ?? "unavailable"}
          data-solver-fingerprint-source="ping.result.solver_executable_sha256"
        >
          {executableSha256 ?? (intl("app_admin_solver_version.workerPingDidNotReturnAValidSolverExecutable"))}
        </code>

        <details className="group mt-4 border-t pt-2" data-solver-fingerprint-details>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-2 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block font-medium">{intl("app_admin_solver_version.fullWorkerFingerprint")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{intl("app_admin_solver_version.buildCommitProtocolVersionsAndPlanContract")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="group-open:hidden">{intl("app_admin_solver_version.expand")}</span>
              <span className="hidden group-open:inline">{intl("app_admin_solver_version.collapse")}</span>
              <ChevronDown aria-hidden="true" className="size-4 transition-transform duration-200 group-open:rotate-180" />
            </span>
          </summary>

          <div className="grid gap-6 px-2 pb-2 pt-5 lg:grid-cols-[1fr_1fr]">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_solver_version.buildIdentity")}</h3>
              <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">solver.git_commit</dt>
                  <dd><FingerprintValue value={solverFingerprint?.envelopeSolverGitCommit ?? null} dataAttribute="data-solver-envelope-git-commit" unavailable={unavailable} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">solver.built_at</dt>
                  <dd><FingerprintValue value={solverFingerprint?.envelopeSolverBuiltAt ?? null} unavailable={unavailable} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">result.solver_git_commit</dt>
                  <dd><FingerprintValue value={solverFingerprint?.solverGitCommit ?? null} dataAttribute="data-solver-git-commit" unavailable={unavailable} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">result.solver_built_at</dt>
                  <dd><FingerprintValue value={solverFingerprint?.solverBuiltAt ?? null} unavailable={unavailable} /></dd>
                </div>
              </dl>
            </div>

            <div className="border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_solver_version.protocolCapabilities")}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="text-xs text-muted-foreground">pong</dt>
                  <dd className="mt-1 text-sm font-medium">{solverFingerprint ? String(solverFingerprint.pong) : unavailable}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">elapsed_ms</dt>
                  <dd><FingerprintValue value={solverFingerprint?.elapsedMs ?? null} unavailable={unavailable} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">protocol_version</dt>
                  <dd><FingerprintValue value={solverFingerprint?.protocolVersion ?? null} unavailable={unavailable} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">plan_schema_version</dt>
                  <dd><FingerprintValue value={solverFingerprint?.planSchemaVersion ?? null} unavailable={unavailable} /></dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">supported_plan_schema_versions</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {solverFingerprint?.supportedPlanSchemaVersions.length
                  ? solverFingerprint.supportedPlanSchemaVersions.map((version) => (
                    <code key={version} className="rounded-md bg-muted px-2 py-1 font-mono text-xs">v{version}</code>
                  ))
                  : <span className="text-xs text-muted-foreground">{unavailable}</span>}
              </div>
            </div>

            <div className="border-t pt-5 lg:col-span-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_solver_version.planContract")}</h3>
              <p className="mt-3 text-xs text-muted-foreground">plan_contract_sha256</p>
              <FingerprintValue value={solverFingerprint?.planContractSha256 ?? null} dataAttribute="data-plan-contract-sha256" unavailable={unavailable} />
              <div className="mt-3 overflow-hidden rounded-xl border">
                {solverFingerprint?.planContractSha256ByVersion.length
                  ? solverFingerprint.planContractSha256ByVersion.map(({ version, sha256 }, index) => (
                    <div
                      key={version}
                      className={`grid grid-cols-[auto_1fr] gap-3 px-3 py-2.5 ${index ? "border-t" : ""}`}
                      data-plan-contract-version={version}
                    >
                      <span className="text-xs font-medium text-muted-foreground">v{version}</span>
                      <code className="min-w-0 break-all text-right font-mono text-xs leading-5">{sha256}</code>
                    </div>
                  ))
                  : <p className="px-3 py-2.5 text-xs text-muted-foreground">{intl("app_admin_solver_version.theWorkerDidNotReturnPerVersionContractFingerprints")}</p>}
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
