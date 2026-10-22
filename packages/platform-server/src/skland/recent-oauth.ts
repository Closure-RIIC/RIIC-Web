import { createHash } from "node:crypto";

const TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 512;

/** Server memory only; bind reuse to both the website owner and the exact Skland login. */
export class RecentSklandOAuth {
  private entries = new Map<string, { token: string; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();

  private key(owner: string, cred: string) {
    return createHash("sha256").update(JSON.stringify([owner, cred])).digest("hex");
  }

  private remove(key: string) {
    clearTimeout(this.entries.get(key)?.timer);
    this.entries.delete(key);
  }

  remember(owner: string, cred: string, token: string, now = Date.now()) {
    const key = this.key(owner, cred);
    this.remove(key);
    if (this.entries.size >= MAX_ENTRIES) this.remove(this.entries.keys().next().value!);
    const timer = setTimeout(() => this.remove(key), TTL_MS);
    timer.unref();
    this.entries.set(key, { token, expiresAt: now + TTL_MS, timer });
  }

  get(owner: string, cred: string, now = Date.now()): string | null {
    const key = this.key(owner, cred);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) { this.remove(key); return null; }
    return entry.token;
  }
}

const state = globalThis as typeof globalThis & { __riicRecentSklandOAuth?: RecentSklandOAuth };
export const recentSklandOAuth = state.__riicRecentSklandOAuth ??= new RecentSklandOAuth();
