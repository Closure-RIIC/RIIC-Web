"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { requestAdminData } from "@/lib/admin-request";

export type AdminFetch = typeof fetch;
const liveFetch: AdminFetch = (input, init) => fetch(input, init);
const AdminDataContext = createContext<{ request: AdminFetch; basePath: string }>({
  request: liveFetch,
  basePath: "/admin",
});

export function AdminDataProvider({ request, basePath, children }: {
  request: AdminFetch; basePath: string; children: ReactNode;
}) {
  return <AdminDataContext.Provider value={{ request, basePath }}>{children}</AdminDataContext.Provider>;
}

export function useAdminFetch() {
  return useContext(AdminDataContext).request;
}

export function useAdminHref() {
  const { basePath } = useContext(AdminDataContext);
  return useCallback((path: string) => path.replace(/^\/admin(?=\/|\?|$)/, basePath), [basePath]);
}

export function useAdminRequest() {
  const request = useAdminFetch();
  return useCallback(<T,>(url: string, init?: RequestInit, fallback: string | boolean = false) =>
    requestAdminData<T>(url, init, typeof fallback === "string" ? fallback : fallback ? "Request failed" : "请求失败", request),
  [request]);
}
