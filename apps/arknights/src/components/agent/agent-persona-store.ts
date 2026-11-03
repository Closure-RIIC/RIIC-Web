"use client";

import { useSyncExternalStore } from "react";
import { AGENT_PERSONA_SELECTION_KEY, resolveAgentPersonaSelection, type AgentPersona, type UploadedAgentPersona } from "@/agent-personas";
import { LEGACY_PERSONA_STORAGE_KEY, LOCAL_PERSONAS_STORAGE_KEY, readLocalPersonas, writeLocalPersonas } from "@/agent-persona-storage";

export { MAX_PERSONA_LENGTH } from "@/agent-persona-storage";
type PersonaPreferences = { selectedPersona: AgentPersona | null; uploadedPersonas: UploadedAgentPersona[] };
const emptyPreferences: PersonaPreferences = { selectedPersona: null, uploadedPersonas: [] };
const listeners = new Set<() => void>();
let preferences: PersonaPreferences | undefined;
let storageWriteFailed = false;

function readPreferences(): PersonaPreferences {
  let uploadedPersonas: UploadedAgentPersona[] = [];
  try {
    uploadedPersonas = readLocalPersonas(window.localStorage);
    return { uploadedPersonas, selectedPersona: resolveAgentPersonaSelection(window.localStorage.getItem(AGENT_PERSONA_SELECTION_KEY), uploadedPersonas) };
  } catch {
    return { uploadedPersonas, selectedPersona: uploadedPersonas[0] ?? null };
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
  if (event.key !== null && event.key !== LOCAL_PERSONAS_STORAGE_KEY && event.key !== LEGACY_PERSONA_STORAGE_KEY && event.key !== AGENT_PERSONA_SELECTION_KEY) return;
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
  const uploadedPersonas = current.uploadedPersonas.some(card => card.id === persona.id)
    ? current.uploadedPersonas.map(card => card.id === persona.id ? persona : card)
    : [...current.uploadedPersonas, persona];
  let saved = true;
  try { writeLocalPersonas(window.localStorage, uploadedPersonas); }
  catch { saved = false; storageWriteFailed = true; }
  publish({ uploadedPersonas, selectedPersona: current.selectedPersona?.id === persona.id ? persona : current.selectedPersona });
  return saved;
}

export function updateLocalPersonaAvatar(id: string, avatarUrl?: string): boolean {
  const persona = snapshot().uploadedPersonas.find(card => card.id === id);
  return persona ? saveLocalPersona({ ...persona, avatarUrl }) : false;
}

export function removeLocalPersona(id: string): boolean {
  const current = snapshot();
  const uploadedPersonas = current.uploadedPersonas.filter(persona => persona.id !== id);
  try { writeLocalPersonas(window.localStorage, uploadedPersonas); }
  catch { storageWriteFailed = true; return false; }
  const selectedPersona = current.selectedPersona?.id === id ? null : current.selectedPersona;
  if (current.selectedPersona?.id === id) {
    try { window.localStorage.setItem(AGENT_PERSONA_SELECTION_KEY, "default"); }
    catch { storageWriteFailed = true; }
  }
  publish({ uploadedPersonas, selectedPersona });
  return true;
}

const serverSnapshot = () => emptyPreferences;

export function useAgentPersona() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
