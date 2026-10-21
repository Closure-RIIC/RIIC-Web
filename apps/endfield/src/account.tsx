import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { parseWebsiteSession, type WebsiteSessionData } from "@shared/shell/account-session";
import { useWorkspace, WEBSITE_SIGN_OUT_EVENT, WEBSITE_SESSION_CHANGE_EVENT } from "./state";

export type AccountAction = "sign-out" | "extend" | "revoke" | "delete";
function useAccountState(initialSession?: WebsiteSessionData | null) {
  const { setSklandSnapshot } = useWorkspace();
  const [bootstrap] = useState(() => initialSession);
  const [session, setSession] = useState(initialSession ?? null);
  const [pending, setPending] = useState(initialSession === undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<AccountAction | null>(null);
  const revision = useRef(0);
  const actionPending = useRef(false);
  const owner = useRef(initialSession?.user.id);
  const refresh = useCallback(async () => {
    if (actionPending.current) return;
    const current = ++revision.current;
    try {
      const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      const next = parseWebsiteSession(await response.json());
      if (current !== revision.current) return;
      const changedOwner = owner.current !== next?.user.id;
      if (changedOwner) setSklandSnapshot(null);
      owner.current = next?.user.id;
      setSession(next); setFailed(false);
      if (changedOwner) window.dispatchEvent(new Event(WEBSITE_SESSION_CHANGE_EVENT));
    } catch {
      if (current === revision.current) { setFailed(true); setSession(null); setSklandSnapshot(null); }
    } finally {
      if (current === revision.current) setPending(false);
    }
  }, [setSklandSnapshot]);
  useEffect(() => {
    if (bootstrap === undefined) void refresh();
    const focus = () => { void refresh(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    const invalidate = () => { ++revision.current; };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", restore);
    return () => {
      invalidate();
      window.removeEventListener("focus", focus); window.removeEventListener("pageshow", restore);
    };
  }, [bootstrap, refresh]);
  async function run(action: AccountAction, password?: string) {
    if (actionPending.current) throw new Error("BUSY");
    actionPending.current = true;
    ++revision.current;
    setBusy(action);
    try {
      const response = await fetch(action === "sign-out" ? "/api/auth/sign-out" : `/api/account/settings/${action}`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "delete" ? { password } : {}), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || result?.success !== true) throw new Error(response.status === 401 ? "SIGNED_OUT" : result?.error?.code === "INVALID_PASSWORD" ? "INVALID_PASSWORD" : "REQUEST_FAILED");
      if (action === "extend") {
        if (typeof result.data?.expiresAt !== "string") throw new Error("REQUEST_FAILED");
        setSession(current => current ? { ...current, session: { expiresAt: result.data.expiresAt } } : null);
      } else {
        owner.current = undefined;
        setSession(null); setSklandSnapshot(null);
        window.dispatchEvent(new Event(WEBSITE_SIGN_OUT_EVENT));
      }
      setFailed(false);
    } finally {
      actionPending.current = false; setBusy(null); setPending(false);
    }
  }
  return { session, pending, failed, busy, refresh, run };
}
const AccountContext = createContext<ReturnType<typeof useAccountState> | null>(null);
export function AccountProvider({ children, initialSession }: { children: ReactNode; initialSession?: WebsiteSessionData | null }) {
  const value = useAccountState(initialSession);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("Missing account provider");
  return value;
}
