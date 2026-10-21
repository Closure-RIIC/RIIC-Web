export const AUTH_EMAIL_BRAND = "可露希尔基建终端";

export function brandedAuthEmailFrom(configuredFrom: string): string {
  const configured = configuredFrom.trim();
  const bracketedAddress = configured.match(/<([^<>]+)>$/)?.[1]?.trim();
  return `${AUTH_EMAIL_BRAND} <${bracketedAddress || configured}>`;
}
