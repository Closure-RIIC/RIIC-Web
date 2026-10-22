import { enforceRateLimit } from "../api-contract.ts";

export const SKLAND_POLL_RATE_WINDOW_MS = 10 * 60_000;
export const MAX_SKLAND_POLLS_PER_ACCOUNT = 360;
export const MAX_SKLAND_POLLS_PER_IP = 3_600;

export function enforceSklandPollRateLimit(websiteUserId: string, ip: string): void {
  // A QR lasts ten minutes and the client polls every six seconds. Account-first
  // limits let several tabs share one login without making users on the same NAT
  // consume each other's normal allowance; the wider IP ceiling still caps abuse.
  enforceRateLimit(
    "skland-poll-account",
    websiteUserId,
    MAX_SKLAND_POLLS_PER_ACCOUNT,
    SKLAND_POLL_RATE_WINDOW_MS,
  );
  enforceRateLimit(
    "skland-poll-ip",
    ip,
    MAX_SKLAND_POLLS_PER_IP,
    SKLAND_POLL_RATE_WINDOW_MS,
  );
}
