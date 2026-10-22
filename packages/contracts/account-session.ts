/** Public session view only. Never serialize the auth library's full session. */
export interface WebsiteSessionData {
  session: { expiresAt: Date | string };
  user: { id: string; name: string; email: string };
}

export function parseWebsiteSession(value: unknown): WebsiteSessionData | null {
  if (!value || typeof value !== "object") return null;
  const user = "user" in value ? value.user : null;
  const session = "session" in value ? value.session : null;
  if (
    !user || typeof user !== "object"
    || !("id" in user) || typeof user.id !== "string" || !user.id
    || !("name" in user) || typeof user.name !== "string"
    || !("email" in user) || typeof user.email !== "string"
    || !session || typeof session !== "object"
    || !("expiresAt" in session)
    || (typeof session.expiresAt !== "string" && !(session.expiresAt instanceof Date))
  ) return null;
  return {
    session: { expiresAt: session.expiresAt },
    user: { id: user.id, name: user.name, email: user.email },
  };
}

/** Undefined means unavailable and allows a client retry; null means signed out. */
export async function loadSessionBootstrap(
  readSession: () => Promise<unknown>,
): Promise<WebsiteSessionData | null | undefined> {
  try {
    return parseWebsiteSession(await readSession());
  } catch {
    return undefined;
  }
}
