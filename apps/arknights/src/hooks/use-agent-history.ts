"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { UIMessage } from "ai";
import { emptyAgentHistory, mergeAgentHistories, parseAgentHistory, updateAgentConversation, type AgentHistory } from "@/agent-history";
import { useWebsiteSession } from "@/website-session";

// IndexedDB retains attachments and tool results without localStorage's small string quota.
const DATABASE = "riic-agent-history-v1";
const OBJECT_STORE = "accounts";
type Snapshot = { ready: boolean; history: AgentHistory; error: boolean };
const initialSnapshot: Snapshot = { ready: false, history: emptyAgentHistory(), error: false };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(OBJECT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("History database blocked"));
  });
}

async function readHistory(owner: string): Promise<AgentHistory> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(OBJECT_STORE).objectStore(OBJECT_STORE).get(owner);
      request.onsuccess = () => resolve(parseAgentHistory(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function writeHistory(owner: string, history: AgentHistory): Promise<AgentHistory> {
  const database = await openDatabase();
  try {
    return await new Promise<AgentHistory>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      const records = transaction.objectStore(OBJECT_STORE);
      const request = records.get(owner);
      let saved = history;
      request.onsuccess = () => {
        // Merge inside one transaction so another tab's conversation is not lost.
        const current = parseAgentHistory(request.result);
        saved = mergeAgentHistories(current, history);
        records.put(saved, owner);
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

class AgentHistoryStore {
  private snapshot = initialSnapshot;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | undefined;
  private writes = Promise.resolve();
  constructor(private owner: string | null) {}
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initialSnapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  load = () => {
    this.loading ??= (async () => {
      try {
        const history = this.owner ? await readHistory(this.owner) : emptyAgentHistory();
        // A document starts a fresh chat; saved conversations remain selectable.
        // Stores survive route changes and floating-panel toggles within this page.
        history.activeId = crypto.randomUUID();
        this.publish({ ready: true, history, error: false });
      } catch {
        this.publish({ ready: true, history: { ...emptyAgentHistory(), activeId: crypto.randomUUID() }, error: true });
      }
    })();
    return this.loading;
  };
  private persist(history: AgentHistory) {
    this.publish({ ...this.snapshot, history });
    if (!this.owner) return;
    const owner = this.owner;
    // Queue writes so an older stream checkpoint can never overwrite a newer reply.
    this.writes = this.writes.then(() => writeHistory(owner, history)).then((saved) => {
      if (this.snapshot.history === history) this.publish({ ...this.snapshot, history: saved, error: false });
      else if (this.snapshot.error) this.publish({ ...this.snapshot, error: false });
    }).catch(() => this.publish({ ...this.snapshot, error: true }));
  }
  save = (id: string, messages: UIMessage[]) => {
    if (!this.snapshot.ready || !this.owner) return;
    const next = updateAgentConversation(this.snapshot.history, id, messages);
    if (next !== this.snapshot.history) this.persist(next);
  };
  select = (id: string) => {
    if (!this.snapshot.history.conversations.some((entry) => entry.id === id)) return;
    this.persist({ ...this.snapshot.history, activeId: id });
  };
  startNew = () => {
    if (!this.snapshot.ready) {
      void this.load().then(() => this.startNew());
      return;
    }
    this.persist({ ...this.snapshot.history, activeId: crypto.randomUUID() });
  };
  toggleExpanded = () => this.persist({ ...this.snapshot.history, expanded: !this.snapshot.history.expanded });
}

const stores = new Map<string | null, AgentHistoryStore>();
function getStore(owner: string | null) {
  let store = stores.get(owner);
  if (!store) { store = new AgentHistoryStore(owner); stores.set(owner, store); }
  return store;
}

export function useAgentHistory() {
  const { data, isPending } = useWebsiteSession();
  const owner = !isPending ? data?.user.id ?? null : null;
  const store = getStore(owner);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => { void store.load(); }, [store]);
  return { ...snapshot, owner, store, ready: !isPending && snapshot.ready };
}
