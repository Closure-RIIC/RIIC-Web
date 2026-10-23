"use client";

import { useEffect, useState } from "react";

const ACCOUNT_ACTIVITY_EVENT = "riic:account-activity";
let sequence = 0;

export type AccountActivity = {
  id: number;
  kind: "account";
  phase: "success";
  error: null;
  title: string;
  description: string;
};

/** Transient feedback stays in this tab and never enters account or game storage. */
export function reportAccountActivity(message: Pick<AccountActivity, "title" | "description">) {
  const detail: AccountActivity = { ...message, id: ++sequence, kind: "account", phase: "success", error: null };
  window.dispatchEvent(new CustomEvent<AccountActivity>(ACCOUNT_ACTIVITY_EVENT, { detail }));
}

export function useAccountActivity() {
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  useEffect(() => {
    const receive = (event: Event) => setActivity((event as CustomEvent<AccountActivity>).detail);
    window.addEventListener(ACCOUNT_ACTIVITY_EVENT, receive);
    return () => window.removeEventListener(ACCOUNT_ACTIVITY_EVENT, receive);
  }, []);
  return activity;
}
