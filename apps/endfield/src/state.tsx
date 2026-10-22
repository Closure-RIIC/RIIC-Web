import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_OPTIONS, STORAGE_KEY, manualTemplate, parseWorkspace, type Assignment, type Result, type Workspace } from "@riic/endfield-solver/model.mjs";
import type { EndfieldSnapshot } from "@riic/endfield-skland/model";
import { ENDFIELD_LOCALE_COOKIE, DISPLAY_STORAGE_KEY, readEndfieldColorMode, readEndfieldLocale, clearEndfieldStorage } from "./local-settings";
import { completeSolverActivity, type SolverActivity, type SolverMessage } from "./solver-activity";
import type { SklandSyncActivity, SklandSyncStatus } from "./skland-workspace";
import { RESULT_STORAGE_KEY, encodeResultCache, restoreResultCache, workspaceKey } from "./result-cache";

export const WEBSITE_SIGN_OUT_EVENT = "riic:endfield:sign-out";
export const WEBSITE_SESSION_CHANGE_EVENT = "riic:endfield:session-change";

function useWorkspaceState() {
  const [workspace, setWorkspace] = useState<Workspace>(() => ({ version: 1, operators: [], options: structuredClone(DEFAULT_OPTIONS) }));
  const workspaceRef = useRef(workspace);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [locale, updateLocale] = useState<"zh" | "en">("zh");
  const [colorMode, updateColorMode] = useState<"light" | "dark">("light");
  const [showImages, updateShowImages] = useState(true);
  const [showDijiangBackdrop, updateShowDijiangBackdrop] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [resultStorageError, setResultStorageError] = useState("");
  // Display-only, tab-lifetime data; never written into the solver workspace/storage.
  const [sklandSnapshot, setSklandSnapshot] = useState<EndfieldSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<SolverActivity | null>(null);
  const [sklandSyncActivity, setSklandSyncActivity] = useState<SklandSyncActivity | null>(null);
  const activitySequence = useRef(0);
  const lastAssignments = useRef<Assignment[] | undefined>(undefined);
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSave = useRef(false);
  useEffect(() => {
    const clear = () => { setSklandSyncActivity(null); setSklandSnapshot(null); };
    window.addEventListener(WEBSITE_SIGN_OUT_EVENT, clear);
    window.addEventListener(WEBSITE_SESSION_CHANGE_EVENT, clear);
    return () => { window.removeEventListener(WEBSITE_SIGN_OUT_EVENT, clear); window.removeEventListener(WEBSITE_SESSION_CHANGE_EVENT, clear); };
  }, []);
  function reportSklandSync(status: SklandSyncStatus) {
    const warning = status.blocked || status.partial || !status.facilitiesApplied || status.unsupported.length || status.excluded.length;
    setSklandSyncActivity({ id: ++activitySequence.current, kind: "skland", phase: warning ? "warning" : "success", status });
  }
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const restored = parseWorkspace(saved);
        workspaceRef.current = restored;
        setWorkspace(restored);
        setResult(restoreResultCache(localStorage.getItem(RESULT_STORAGE_KEY), restored));
      }
    }
    catch { setStorageError("本地存档无法读取，未覆盖原文件。请导出备份后重新导入。 / Cannot restore local data; the saved copy has not been overwritten."); }
    // Migrate once; subsequent language choices belong to Endfield only, even on localhost.
    setLocale(readEndfieldLocale(document.cookie));
    try {
      updateColorMode(readEndfieldColorMode(localStorage.getItem("riic-color-mode")));
      const display = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) ?? "{}");
      updateShowImages(display.showImages !== false);
      updateShowDijiangBackdrop(display.showDijiangBackdrop === true);
    } catch { /* Keep defaults when storage is unavailable. */ }
    setReady(true);
    return () => { worker.current?.terminate(); if (timeout.current) clearTimeout(timeout.current); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", colorMode === "dark");
    document.documentElement.style.colorScheme = colorMode;
  }, [colorMode, ready]);
  // Restore this site's preferences after tab or history navigation.
  useEffect(() => {
    const restorePreferences = () => {
      updateLocale(readEndfieldLocale(document.cookie));
      try {
        updateColorMode(readEndfieldColorMode(localStorage.getItem("riic-color-mode")));
        const display = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) ?? "{}");
        updateShowImages(display.showImages !== false);
        updateShowDijiangBackdrop(display.showDijiangBackdrop === true);
      } catch { /* Keep the current appearance if storage is unavailable. */ }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "riic-color-mode" || event.key === DISPLAY_STORAGE_KEY) restorePreferences(); };
    window.addEventListener("focus", restorePreferences);
    window.addEventListener("pageshow", restorePreferences);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", restorePreferences);
      window.removeEventListener("pageshow", restorePreferences);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    if (!ready || storageError || skipSave.current) return;
    const id = setTimeout(() => {
      if (skipSave.current) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
      catch { setStorageError("无法保存到本机，请导出名单。 / Local storage unavailable; export your roster."); }
    }, 250);
    return () => clearTimeout(id);
  }, [ready, storageError, workspace]);
  useEffect(() => {
    if (!ready || storageError || skipSave.current) return;
    try {
      const saved = encodeResultCache(workspace, result);
      if (saved) localStorage.setItem(RESULT_STORAGE_KEY, saved);
      else localStorage.removeItem(RESULT_STORAGE_KEY);
      setResultStorageError("");
    } catch {
      setResultStorageError("求解结果暂时只能保留在当前页面会话，无法保存到本机。 / Result is available in this session but could not be saved locally.");
    }
  }, [ready, storageError, workspace, result]);
  // Persist before cross-app navigation as well as before closing the tab.
  useEffect(() => {
    const save = () => { if (ready && !storageError && !skipSave.current) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); } catch { /* Already surfaced by debounced save. */ } } };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [ready, storageError, workspace]);
  const stopWorker = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null; setBusy(false);
  }, []);
  const cancel = useCallback(() => {
    stopWorker();
    setActivity(null);
  }, [stopWorker]);
  function clearResult() { cancel(); setResult(null); }
  function update(next: Workspace | ((current: Workspace) => Workspace)) {
    const current = workspaceRef.current;
    let value = typeof next === "function" ? next(current) : next;
    if (value.manual) {
      const owned = new Set(value.operators.map(op => op.name));
      const manual = value.manual;
      value = { ...value, manual: manualTemplate(value.options).map(template => {
        const old = manual.find(room => room.key === template.key);
        if (!old) return template;
        const crew = (names: string[]) => names.slice(0, template.slots).map(name => owned.has(name) ? name : "");
        return { ...template, hour: old.hour, a: crew(old.a), b: crew(old.b) };
      }) };
    }
    if (workspaceKey(value) === workspaceKey(current)) return;
    clearResult();
    workspaceRef.current = value;
    setWorkspace(value);
  }
  function repairStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); skipSave.current = false; setStorageError(""); }
    catch { setStorageError("无法保存到本机，请导出名单。 / Local storage unavailable; export your roster."); }
  }
  function run(assignments?: Assignment[]) {
    cancel(); setResult(null);
    lastAssignments.current = assignments ? structuredClone(assignments) : undefined;
    const started: SolverActivity = {
      id: ++activitySequence.current, kind: assignments ? "manual" : "schedule",
      phase: "running", stage: "preparing", startedAt: Date.now(), elapsedMs: 0,
    };
    setActivity(started);
    const fail = (message: string) => {
      stopWorker();
      setActivity({ ...started, phase: "error", problem: "worker", error: message, elapsedMs: Date.now() - started.startedAt });
    };
    try {
      const instance = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance; setBusy(true);
      instance.onmessage = (event: MessageEvent<SolverMessage>) => {
        if (worker.current !== instance) return;
        const message = event.data;
        if (message.type === "progress") {
          setActivity(current => current?.id === started.id && current.phase === "running"
            ? { ...current, ...message.progress } : current);
        } else if (message.type === "result") {
          stopWorker();
          setResult(message.result);
          setActivity(completeSolverActivity(started, message.result));
        } else {
          fail(message.error);
        }
      };
      instance.onerror = () => { if (worker.current === instance) fail("求解进程异常，请重试。 / Solver worker failed; please retry."); };
      timeout.current = setTimeout(() => {
        if (worker.current === instance) fail("搜索超时，已释放计算资源。请减少名单或调整配置。 / Search timed out; try a smaller roster.");
      }, workspace.options.time + 10000);
      instance.postMessage({ input: workspace, assignments });
    } catch { fail("无法启动求解进程。 / Unable to start the solver."); }
  }
  function retrySolve() { if (!worker.current) run(lastAssignments.current); }
  function setLocale(next: "zh" | "en") {
    updateLocale(next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    document.cookie = `${ENDFIELD_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function setColorMode(next: "light" | "dark") {
    updateColorMode(next);
    try { localStorage.setItem("riic-color-mode", next); } catch { /* Current tab still works. */ }
  }
  function setShowImages(next: boolean) {
    updateShowImages(next);
    try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ showImages: next, showDijiangBackdrop })); } catch { /* Current tab still works. */ }
  }
  function setShowDijiangBackdrop(next: boolean) {
    updateShowDijiangBackdrop(next);
    try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ showImages, showDijiangBackdrop: next })); } catch { /* Current tab still works. */ }
  }
  async function clearLocalData() {
    cancel();
    skipSave.current = true;
    try {
      clearEndfieldStorage(localStorage, sessionStorage);
      if (window.caches) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
      location.reload();
    } catch {
      // Do not let pagehide silently put a deleted archive back.
      setStorageError("无法清除全部本地数据，请导出配置后重试。 / Could not clear all local data; export your setup before retrying.");
      throw new Error("无法清除全部本地数据，请检查浏览器存储权限。 / Could not clear local data; check browser storage permissions.");
    }
  }
  return { workspace, update, ready, storageError, resultStorageError, repairStorage, clearLocalData, clearResult, locale, setLocale, colorMode, setColorMode, showImages, setShowImages, showDijiangBackdrop, setShowDijiangBackdrop, result, sklandSnapshot, setSklandSnapshot, sklandSyncActivity, reportSklandSync, setSklandSyncActivity, busy, activity, retrySolve, run, cancel, t: (zh: string, en: string) => locale === "zh" ? zh : en };
}
const Context = createContext<ReturnType<typeof useWorkspaceState> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) { const value = useWorkspaceState(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error("Missing Endfield workspace"); return value; }
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
