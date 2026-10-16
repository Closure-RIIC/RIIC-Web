import "@tanstack/react-start/server-only";

const COOKIE_NAME = "aic_local_test_account";
const ACCOUNT = {
  id: "local-test-user",
  name: "本地测试账号",
  email: process.env.LOCAL_TEST_ACCOUNT_EMAIL ?? "codex.test@local.dev",
  password: process.env.LOCAL_TEST_ACCOUNT_PASSWORD ?? "CodexTest-5174-Local!",
} as const;

function enabled(input: Request | Headers) {
  if (process.env.APP_DEPLOYMENT_ENV !== "local" || process.env.NODE_ENV === "production") return false;
  const headers = input instanceof Headers ? input : input.headers;
  try {
    const host = new URL(`http://${headers.get("host") ?? ""}`).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

function hasCookie(input: Request | Headers) {
  const value = input instanceof Headers ? input.get("cookie") : input.headers.get("cookie");
  return value?.split(";").some((part) => part.trim() === `${COOKIE_NAME}=enabled`) === true;
}

function autoSessionAllowed(input: Request | Headers) {
  if (process.env.LOCAL_TEST_AUTO_SIGN_IN !== "1" || !(input instanceof Request)) return false;
  const host = new URL(`http://${input.headers.get("host") ?? ""}`).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function localTestSession(input: Request | Headers) {
  if (!enabled(input) || (!hasCookie(input) && !autoSessionAllowed(input))) return null;
  return {
    session: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) },
    user: {
      id: ACCOUNT.id,
      name: ACCOUNT.name,
      email: ACCOUNT.email,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      emailVerified: true,
    },
  };
}

export async function localTestAuthResponse(request: Request): Promise<Response | null> {
  if (!enabled(request)) return null;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  }
  if (request.method === "GET" && pathname === "/api/auth/get-session") {
    return Response.json(localTestSession(request));
  }
  if (request.method === "POST" && pathname === "/api/auth/sign-in/email") {
    const body = await request.clone().json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    if (body?.email !== ACCOUNT.email || body.password !== ACCOUNT.password) return null;
    return Response.json({
      user: {
        id: ACCOUNT.id,
        name: ACCOUNT.name,
        email: ACCOUNT.email,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        emailVerified: true,
      },
    }, {
      headers: { "Set-Cookie": `${COOKIE_NAME}=enabled; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax` },
    });
  }
  if (request.method === "POST" && pathname === "/api/auth/sign-out" && hasCookie(request)) {
    return Response.json({ success: true }, {
      headers: { "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
    });
  }
  return null;
}
