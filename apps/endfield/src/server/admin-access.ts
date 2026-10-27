import { accountHeaders, accountOrigin } from "./account-origin.ts";

/**
 * 本地开发便利：没有配置账号服务、且请求来自回环地址时直接放行。
 * 生产环境（NODE_ENV=production）或配置了账号服务时绝不生效，
 * 因此不会把正式部署的管理员边界打开。
 */
function localDevelopmentBypass(request: Request): boolean {
  if (process.env.NODE_ENV === "production" || process.env.APP_DEPLOYMENT_ENV === "production") return false;
  if (process.env.PLATFORM_API_ORIGIN?.trim() || process.env.ENDFIELD_ACCOUNT_ORIGIN?.trim()) return false;
  try {
    const host = new URL(request.url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export async function canAccessEndfield(request: Request): Promise<boolean> {
  if (localDevelopmentBypass(request)) return true;
  const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .filter(value => /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(value)).join("; ");
  if (!cookie) return false;
  try {
    const response = await fetch(new URL("/api/platform/endfield-access", accountOrigin(request)), {
      headers: accountHeaders(request, { cookie, accept: "application/json" }),
      redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    return response.status === 204;
  } catch { return false; }
}

export function endfieldNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
