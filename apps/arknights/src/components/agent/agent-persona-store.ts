"use client";

import { useSyncExternalStore } from "react";
import { AGENT_PERSONA_SELECTION_KEY, resolveAgentPersonaSelection, type AgentPersona, type UploadedAgentPersona } from "@/agent-personas";
import { parsePersonaAvatar } from "@/agent-persona-avatar";

export const MAX_PERSONA_LENGTH = 36_000;
const LOCAL_PERSONA_STORAGE_KEY = "riic.agent.persona.v1";
type PersonaPreferences = { selectedPersona: AgentPersona | null; uploadedPersona: UploadedAgentPersona | null };
const emptyPreferences: PersonaPreferences = { selectedPersona: null, uploadedPersona: null };
const listeners = new Set<() => void>();
let preferences: PersonaPreferences | undefined;
let storageWriteFailed = false;

function readLocalPersona(): UploadedAgentPersona | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_PERSONA_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.content !== "string" || !value.content.trim() || value.content.length > MAX_PERSONA_LENGTH) return null;
    return {
      id: typeof value.id === "string" ? value.id : `local-${Date.now()}`,
      name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 40) : "",
      description: typeof value.description === "string" ? value.description.slice(0, 120) : "",
      content: value.content.slice(0, MAX_PERSONA_LENGTH),
      kind: "upload",
      filename: typeof value.filename === "string" ? value.filename.slice(0, 120) : undefined,
      avatarUrl: parsePersonaAvatar(value.avatarUrl),
    };
  } catch {
    return null;
  }
}

function readPreferences(): PersonaPreferences {
  const uploadedPersona = readLocalPersona();
  try {
    return { uploadedPersona, selectedPersona: resolveAgentPersonaSelection(window.localStorage.getItem(AGENT_PERSONA_SELECTION_KEY), uploadedPersona) };
  } catch {
    return { uploadedPersona, selectedPersona: uploadedPersona };
  }
}

function snapshot(): PersonaPreferences {
  preferences ??= readPreferences();
  return preferences;
}

function publish(next: PersonaPreferences) {
  preferences = next;
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== LOCAL_PERSONA_STORAGE_KEY && event.key !== AGENT_PERSONA_SELECTION_KEY) return;
  storageWriteFailed = false;
  publish(readPreferences());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    if (!storageWriteFailed) preferences = readPreferences();
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setAgentPersonaSelection(persona: AgentPersona | null): boolean {
  const current = snapshot();
  let saved = true;
  try { window.localStorage.setItem(AGENT_PERSONA_SELECTION_KEY, persona?.id ?? "default"); }
  catch { saved = false; storageWriteFailed = true; }
  publish({ ...current, selectedPersona: persona });
  return saved;
}

export function saveLocalPersona(persona: UploadedAgentPersona): boolean {
  const current = snapshot();
  let saved = true;
  try {
    window.localStorage.setItem(LOCAL_PERSONA_STORAGE_KEY, JSON.stringify({
      version: 1,
      id: persona.id,
      name: persona.name,
      description: persona.description,
      content: persona.content,
      filename: persona.filename,
      avatarUrl: persona.avatarUrl,
      savedAt: new Date().toISOString(),
    }));
  } catch { saved = false; storageWriteFailed = true; }
  publish({ uploadedPersona: persona, selectedPersona: current.selectedPersona?.id === persona.id ? persona : current.selectedPersona });
  return saved;
}

export function clearLocalPersona() {
  const current = snapshot();
  try { window.localStorage.removeItem(LOCAL_PERSONA_STORAGE_KEY); }
  catch { storageWriteFailed = true; }
  publish({ ...current, uploadedPersona: null });
}

const serverSnapshot = () => emptyPreferences;

export function useAgentPersona() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
