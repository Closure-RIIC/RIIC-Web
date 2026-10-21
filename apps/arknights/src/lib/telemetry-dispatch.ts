import type { TelemetryInput } from "@/telemetry-contract";

/** Keep telemetry implementation out of the initial application bundle. */
export function trackTelemetry(input: TelemetryInput, flush = false): void {
  void import("./telemetry")
    .then(({ track, flushTelemetry }) => {
      track(input);
      if (flush) flushTelemetry();
    })
    .catch(() => undefined);
}
