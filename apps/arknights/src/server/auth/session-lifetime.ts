export const WEBSITE_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

export function extendedSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + WEBSITE_SESSION_DURATION_SECONDS * 1_000);
}

function authSessionCookieName(request: Request): string {
  if (cookieValue(request, "__Secure-better-auth.session_token")) return "__Secure-better-auth.session_token";
  return new URL(request.url).protocol === "https:"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";
}

function cookieValue(request: Request, name: string): string | null {
  for (const entry of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name && value.length > 0) return value.join("=");
  }
  return null;
}

export function extendedSessionCookie(request: Request): string | null {
  const name = authSessionCookieName(request);
  const value = cookieValue(request, name);
  if (!value) return null;
  return `${name}=${value}; Path=/; Max-Age=${WEBSITE_SESSION_DURATION_SECONDS}; HttpOnly; SameSite=Lax${name.startsWith("__Secure-") ? "; Secure" : ""}`;
}
