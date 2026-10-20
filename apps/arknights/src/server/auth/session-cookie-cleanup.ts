const SKLAND_COOKIE_PREFIX = "skland_";

export function sklandCookieNames(cookieHeader: string | null): string[] {
  return [...new Set((cookieHeader ?? "").split(";").map((cookie) => cookie.split("=", 1)[0]?.trim()).filter((name): name is string => Boolean(name?.startsWith(SKLAND_COOKIE_PREFIX))))];
}

export function responseWithClearedSklandCookies(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwarded === "https" || new URL(request.url).protocol === "https:";
  for (const name of sklandCookieNames(request.headers.get("cookie"))) {
    headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
