import { useTranslations, useLocale } from "use-intl";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedNumber, AnimatedText } from "./AnimatedText";
import { localize as rotationText } from "@riic/arknights-domain/i18n/helpers/RotationLabels";
import { manufacturePoolReady, profileEfficiency } from "@riic/arknights-domain/efficiency";
import { relativeMetricDelta, rotationMetricValue, shiftTeamSummary, type RotationMetricKind } from "../rotation-presentation";
import { DEFAULT_ROTATION_PROFILE } from "@riic/arknights-domain/rotation-settings";
import { MOTION_DURATION, MOTION_EASE_OUT } from "../motion";
import { cn } from "../lib/utils";
import type { UserProfile, RotationJson, BaseBlueprint } from "@riic/arknights-domain/types";

function compactNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.?0+$/, "");
}

function profileSeverityClass(severity: "ok" | "warn" | "critical") {
  if (severity === "critical") return "bg-red-100 text-red-800";
  if (severity === "warn") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

export function PlanTelemetry({
  profile,
  rotation,
  layout,
  activeShift,
  planRevision,
}: {
  profile?: UserProfile;
  rotation?: RotationJson;
  layout: BaseBlueprint;
  activeShift: number;
  planRevision?: string;
}) {
  const intl = useTranslations();
  const shouldReduceMotion = useReducedMotion();
  const locale = useLocale();
  const en = locale;
  if (!profile && !rotation) return null;

  const active = rotation?.shifts?.[activeShift];
  const rotationProfile = rotation?.profile ?? profile?.rotation_profile ?? DEFAULT_ROTATION_PROFILE;
  const selectedRotationLabel = rotationText.text(en, rotationProfile);
  const activeTeamSummary = shiftTeamSummary(active, rotationProfile, en);
  const summary = profile?.summary;
  const manufactureReady = summary ? manufacturePoolReady(summary) : undefined;
  const currentProfileRotation = profile?.rotation;
  const baselineProfileRotation = profile?.baseline_rotation;
  const dailyMetrics = [
    {
      kind: "trade" as const,
      label: intl("components.24hTrading"),
      value: rotation?.daily.trade ?? currentProfileRotation?.daily_trade_efficiency ?? currentProfileRotation?.daily_trade,
      baseline: baselineProfileRotation?.daily_trade_efficiency ?? baselineProfileRotation?.daily_trade,
      suffix: "×",
    },
    {
      kind: "manu" as const,
      label: intl("components.24hManufacturing"),
      value: rotation?.daily.manufacture ?? currentProfileRotation?.daily_manufacture_efficiency ?? currentProfileRotation?.daily_manu,
      baseline: baselineProfileRotation?.daily_manufacture_efficiency ?? baselineProfileRotation?.daily_manu,
      suffix: "%",
    },
    {
      kind: "power" as const,
      label: intl("components.24hPower"),
      value: rotation?.daily.power ?? currentProfileRotation?.daily_power_efficiency ?? currentProfileRotation?.daily_power,
      baseline: baselineProfileRotation?.daily_power_efficiency ?? baselineProfileRotation?.daily_power,
      suffix: "%",
    },
  ].filter((metric): metric is {
    kind: RotationMetricKind;
    label: string;
    value: number;
    baseline: number | undefined;
    suffix: string;
  } => typeof metric.value === "number");
  const domains = profile?.domains ?? [];

  return (
    <motion.section
      className="mb-4 overflow-hidden border-y border-[#313131]/15 bg-[#F3F1EA]"
      aria-label={intl("components.efficiencyOverview")}
      data-plan-summary
      data-plan-revision={planRevision}
      initial={{
        opacity: 0,
        y: shouldReduceMotion ? 0 : 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
        y: shouldReduceMotion ? 0 : -4,
      }}
      transition={{
        duration: shouldReduceMotion ? MOTION_DURATION.feedback : MOTION_DURATION.emphasis,
        delay: shouldReduceMotion ? 0 : 0.06,
        ease: MOTION_EASE_OUT,
      }}
    >
      <div className="grid grid-cols-[auto_1fr] items-stretch max-md:grid-cols-1">
        <div className="flex min-w-36 flex-col justify-center bg-[#313131] px-4 py-3 text-white">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">{intl("components.efficiencyOverview")}</span>
          <strong className="mt-0.5 text-xl font-medium">{intl("components.currentPlan")}</strong>
          <span className="mt-1 text-xs text-white/62">
            <span className="font-number">{layout.template}</span> · <span className="font-number">{layout.rooms.length}</span> {intl("components.facilities")}
          </span>
          <span className="mt-0.5 text-xs text-white/62">
            {selectedRotationLabel} · <span className="font-number">{rotation?.shifts.length ?? 0}</span> {intl("components.shifts")}
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] divide-x divide-[#313131]/10 max-sm:divide-x-0 max-sm:grid-cols-2">
          {dailyMetrics.map((metric, metricIndex) => {
            const value = rotationMetricValue(metric.kind, metric.value);
            const displayDigits = metric.kind === "trade" ? 3 : 1;
            const baseline = typeof metric.baseline === "number"
              ? rotationMetricValue(metric.kind, metric.baseline)
              : undefined;
            const delta = typeof metric.baseline === "number"
              ? relativeMetricDelta(metric.value, metric.baseline)
              : undefined;
            return (
              <motion.div
                key={metric.label}
                className="px-4 py-3"
                data-plan-metric
                initial={{
                  opacity: 0,
                  y: shouldReduceMotion ? 0 : 4,
                }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? MOTION_DURATION.feedback : MOTION_DURATION.content,
                  delay: shouldReduceMotion ? 0 : 0.06 + metricIndex * 0.045,
                  ease: MOTION_EASE_OUT,
                }}
              >
                <span className="font-number block text-xs text-[#313131]/58">{metric.label}</span>
                <strong className="font-technical mt-0.5 block text-lg font-semibold tabular-nums tracking-[0.01em] text-[#313131]">
                  <AnimatedNumber value={`${compactNumber(value, displayDigits)}${metric.suffix}`} />
                </strong>
                <span className="mt-0.5 block whitespace-nowrap text-[10px] tabular-nums text-[#313131]/52">
                  {intl("components.reference")} {baseline === undefined ? "—" : `${compactNumber(baseline, displayDigits)}${metric.suffix}`}
                  {delta === undefined ? null : (
                    <span className={cn("ml-1", delta >= 0 ? "text-emerald-700" : "text-red-700")}>
                      · {delta >= 0 ? "+" : ""}{compactNumber(delta)}%
                    </span>
                  )}
                </span>
              </motion.div>
            );
          })}
          {active ? (
            <motion.div
              className="px-4 py-3"
              data-plan-metric
              initial={{
                opacity: 0,
                y: shouldReduceMotion ? 0 : 4,
              }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: shouldReduceMotion ? MOTION_DURATION.feedback : MOTION_DURATION.content,
                delay: shouldReduceMotion ? 0 : 0.06 + dailyMetrics.length * 0.045,
                ease: MOTION_EASE_OUT,
              }}
            >
              <span className="block text-xs text-[#313131]/58">{intl("components.currentShift")}</span>
              <strong className="font-technical mt-0.5 block text-lg font-semibold tabular-nums tracking-[0.01em] text-[#313131]">
                <AnimatedNumber value={`${compactNumber(active.duration_hours)}h`} />
              </strong>
              {activeTeamSummary ? (
                <span className="mt-0.5 block whitespace-nowrap text-[10px] text-[#313131]/52">
                  <AnimatedText value={activeTeamSummary} />
                </span>
              ) : null}
            </motion.div>
          ) : null}
        </div>
      </div>

      {summary ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[#313131]/10 px-4 py-2 text-xs text-[#313131]/68">
          <span>{intl("components.owned")} <strong className="font-number text-[#313131]">{summary.owned}</strong></span>
          <span>{intl("components.promotionReady")} <strong className="font-number text-[#313131]">{summary.tier_up_owned}</strong></span>
          <span>{intl("components.tradingCandidates")} <strong className="font-number text-[#313131]">{summary.trade_pool_ready}</strong></span>
          {manufactureReady !== undefined ? <span>{intl("components.manufacturingCandidates")} <strong className="font-number text-[#313131]">{manufactureReady}</strong></span> : null}
          <span>{intl("components.controlCenter")} Lv<span className="font-number">.{layout.rooms.find((room) => room.kind === "control_center")?.level ?? "—"}</span></span>
        </div>
      ) : null}

      {domains.length > 0 || profile?.actions.length || profile?.flags.length || profile?.narration_hints.length ? (
        <details className="group border-t border-[#313131]/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-[#313131] marker:content-none">
            <span>{intl("components.efficiencyDetails")} · <span className="font-number">{domains.length}</span> {intl("components.metrics")}</span>
            <span className="text-[#313131]/50 group-open:hidden">{intl("components.expand")}</span>
            <span className="hidden text-[#313131]/50 group-open:inline">{intl("components.collapse")}</span>
          </summary>
          <div className="border-t border-[#313131]/10 bg-white/55 px-4 py-3">
            {domains.length > 0 ? (
              <div className="grid gap-1.5">
                {domains.map((domain) => {
                  const current = profileEfficiency(domain.current);
                  const baseline = profileEfficiency(domain.baseline);
                  return (
                    <div key={domain.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-[#313131]/8 py-1.5 text-xs last:border-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <strong className="block truncate font-medium text-[#313131]">{domain.label}</strong>
                        {domain.current.operators.length ? <span className="block truncate text-xs text-[#313131]/52">{domain.current.operators.join(" / ")}</span> : null}
                        {domain.current.mechanic_equivalent_efficiency !== undefined
                          || domain.baseline.mechanic_equivalent_efficiency !== undefined ? (
                            <span className="mt-0.5 block truncate text-[10px] tabular-nums text-[#313131]/48">
                              {intl("components.mechanicEquivalentCurrent")} {domain.current.mechanic_equivalent_efficiency === undefined
                                ? "—"
                                : compactNumber(domain.current.mechanic_equivalent_efficiency, 3)}
                              {" · "}{intl("components.reference")} {domain.baseline.mechanic_equivalent_efficiency === undefined
                                ? "—"
                                : compactNumber(domain.baseline.mechanic_equivalent_efficiency, 3)}
                            </span>
                          ) : null}
                      </div>
                      <span className="tabular-nums text-[#313131]">{intl("components.current")} {current === undefined ? "—" : compactNumber(current, 2)}</span>
                      <span className="tabular-nums text-[#313131]/55 max-sm:hidden">{intl("components.baseline")} {baseline === undefined ? "—" : compactNumber(baseline, 2)}</span>
                      <span className={cn("rounded-sm px-1.5 py-0.5 text-xs font-semibold", profileSeverityClass(domain.severity))}>
                        {domain.gap_ratio >= 0 ? "+" : ""}{compactNumber(domain.gap_ratio * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {profile?.actions.length ? (
              <ul className="mt-3 grid gap-1 border-t border-[#313131]/10 pt-3 text-xs text-[#313131]/70">
                {profile.actions.map((action, index) => <li key={`${action.domain_id}-${action.operator}-${index}`}><strong className="text-[#313131]">{action.priority}</strong> · {action.message}</li>)}
              </ul>
            ) : null}
            {profile?.flags.length || profile?.narration_hints.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#313131]/10 pt-3">
                {[...(profile?.flags ?? []), ...(profile?.narration_hints ?? [])].map((flag) => <span key={flag} className="bg-[#313131]/7 px-1.5 py-0.5 text-xs text-[#313131]/65">{flag}</span>)}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </motion.section>
  );
}

