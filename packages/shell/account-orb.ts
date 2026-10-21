export const ACCOUNT_ORB_COLORS = [
  "#1A73F2",
  "#FF3B30",
  "#F75001",
  "#34C759",
] as const;

export type AccountOrbColor = (typeof ACCOUNT_ORB_COLORS)[number];

export function accountOrbColor(accountId: string): AccountOrbColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ACCOUNT_ORB_COLORS[(hash >>> 0) % ACCOUNT_ORB_COLORS.length];
}
