import { REQUIRE_REFERRAL_HEADER } from "@riic/contracts/referral";

const REFERRAL_STORAGE_KEY = "riic-referral-code";
const CODE_PATTERN = /^[A-F0-9]{24}$/;
let memoryCode: string | null = null;

export function normalizeReferralCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return CODE_PATTERN.test(code) ? code : null;
}

/** The last invitation opened before signup wins; the server decides eligibility. */
export function rememberReferralCode(value: unknown): string | null {
  const code = normalizeReferralCode(value);
  if (!code) return readReferralCode();
  memoryCode = code;
  try { window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, code); } catch { /* Optional storage. */ }
  return code;
}

export function readReferralCode(): string | null {
  try {
    const stored = normalizeReferralCode(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* Private browsing can disable storage. */ }
  return memoryCode;
}

export function readSignupReferralCode(): string | null {
  // The shared account dialog can submit before the landing page has loaded.
  try {
    const url = new URL(window.location.href);
    const linked = url.pathname === "/referral" && normalizeReferralCode(url.searchParams.get("ref"));
    if (linked) return linked;
  } catch { /* A stored invitation remains usable when location is unavailable. */ }
  return readReferralCode();
}

export function referralSignupHeaders(editedCode?: string): Record<string, string> {
  if (editedCode !== undefined) {
    const code = normalizeReferralCode(editedCode);
    return code ? { "x-riic-referral-code": code, [REQUIRE_REFERRAL_HEADER]: "1" } : {};
  }
  const code = rememberReferralCode(readSignupReferralCode());
  return code ? { "x-riic-referral-code": code } : {};
}

export function clearReferralCode(): void {
  memoryCode = null;
  try { window.sessionStorage.removeItem(REFERRAL_STORAGE_KEY); } catch { /* Optional storage. */ }
}
