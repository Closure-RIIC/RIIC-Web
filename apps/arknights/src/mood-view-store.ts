import { createContext, useCallback, useSyncExternalStore } from "react";
import type { MoodRate } from "@/mood-simulation/types";

type MoodFrame = Readonly<Record<string, number>>;
const emptySubscribe = () => () => {};
const emptySelected = () => "";
export const MoodLayerActiveContext = createContext(true);

export class MoodVisibilityStore {
  private visible: boolean;
  private readonly listeners = new Set<() => void>();
  constructor(visible: boolean) { this.visible = visible; }
  isVisible = (): boolean => this.visible;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const listener of this.listeners) listener();
  }
}
export const MoodLayerVisibilityContext = createContext<MoodVisibilityStore | null>(null);

export class MoodViewStore {
  private moods: MoodFrame = {};
  private selected = "";
  private readonly moodListeners = new Map<string, Set<() => void>>();
  private readonly selectedListeners = new Set<() => void>();

  constructor(private readonly onSelect: (name: string) => void) {}

  getMood(name: string): number {
    return this.moods[name] ?? 24;
  }

  subscribeMood(name: string, listener: () => void): () => void {
    let listeners = this.moodListeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.moodListeners.set(name, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) this.moodListeners.delete(name);
    };
  }

  getSelected(): string {
    return this.selected;
  }

  subscribeSelected(listener: () => void): () => void {
    this.selectedListeners.add(listener);
    return () => { this.selectedListeners.delete(listener); };
  }

  select(name: string): void {
    this.setSelected(name);
    this.onSelect(name);
  }

  setSelected(name: string): void {
    if (this.selected === name) return;
    this.selected = name;
    for (const listener of this.selectedListeners) listener();
  }

  setFrame(moods: MoodFrame, selected: string): void {
    const changed = new Set<string>();
    for (const name of new Set([...Object.keys(this.moods),...Object.keys(moods)])) {
      if (this.getMood(name) !== this.getNextMood(moods, name)) changed.add(name);
    }
    this.moods = moods;
    this.setSelected(selected);
    for (const name of changed) for (const listener of this.moodListeners.get(name) ?? []) listener();
  }

  private getNextMood(moods: MoodFrame, name: string): number {
    return moods[name] ?? 24;
  }
}

export function useMood(store: MoodViewStore | undefined, name: string): number {
  const subscribe = useCallback(
    (listener: () => void) => store ? store.subscribeMood(name, listener) : emptySubscribe(),
    [store, name],
  );
  const getSnapshot = useCallback(
    () => store ? store.getMood(name) : 24,
    [store, name],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 24);
}

export function useMoodSelected(store: MoodViewStore | undefined): string {
  const subscribe = useCallback(
    (listener: () => void) => store ? store.subscribeSelected(listener) : emptySubscribe(),
    [store],
  );
  const getSnapshot = useCallback(
    () => store ? store.getSelected() : "",
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, emptySelected);
}

export interface MoodDetailState { name: string; time: number; rate: MoodRate }
export class MoodPlaybackStore {
  private cursor = 0;
  private readonly listeners = new Set<() => void>();

  getCursor = (): number => this.cursor;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setCursor(cursor: number): void {
    if (this.cursor === cursor) return;
    this.cursor = cursor;
    for (const listener of this.listeners) listener();
  }
}

export function useMoodCursor(store: MoodPlaybackStore): number {
  return useSyncExternalStore(store.subscribe, store.getCursor, () => 0);
}export class MoodDetailStore {
  private value: MoodDetailState | null = null;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): MoodDetailState | null => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  set(value: MoodDetailState | null): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

export function useMoodDetail(store: MoodDetailStore): MoodDetailState | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}
