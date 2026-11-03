import { builtinAgentPersona, type UploadedAgentPersona } from "./agent-personas.ts";
import { parsePersonaAvatar } from "./agent-persona-avatar.ts";

export const MAX_PERSONA_LENGTH = 36_000;
export const LOCAL_PERSONAS_STORAGE_KEY = "riic.agent.personas.v1";
export const LEGACY_PERSONA_STORAGE_KEY = "riic.agent.persona.v1";
type PersonaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parseStoredPersona(value: unknown): UploadedAgentPersona | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const persona = value as Record<string, unknown>;
  if (typeof persona.id !== "string" || !persona.id.trim() || persona.id === "default" || builtinAgentPersona(persona.id)) return null;
  if (typeof persona.content !== "string" || !persona.content.trim() || persona.content.length > MAX_PERSONA_LENGTH) return null;
  return {
    id: persona.id,
    name: typeof persona.name === "string" ? persona.name.slice(0, 40) : "",
    description: typeof persona.description === "string" ? persona.description.slice(0, 120) : "",
    content: persona.content,
    kind: "upload",
    filename: typeof persona.filename === "string" ? persona.filename.slice(0, 120) : undefined,
    avatarUrl: parsePersonaAvatar(persona.avatarUrl),
  };
}

export function writeLocalPersonas(storage: PersonaStorage, personas: readonly UploadedAgentPersona[]): void {
  storage.setItem(LOCAL_PERSONAS_STORAGE_KEY, JSON.stringify({ version: 1, personas }));
  try { storage.removeItem(LEGACY_PERSONA_STORAGE_KEY); } catch { return; }
}

export function readLocalPersonas(storage: PersonaStorage): UploadedAgentPersona[] {
  try {
    const raw = storage.getItem(LOCAL_PERSONAS_STORAGE_KEY);
    if (raw !== null) {
      const collection = JSON.parse(raw) as Record<string, unknown> | null;
      if (!collection || collection.version !== 1 || !Array.isArray(collection.personas)) return [];
      const ids = new Set<string>();
      return collection.personas.flatMap(value => {
        const persona = parseStoredPersona(value);
        if (!persona || ids.has(persona.id)) return [];
        ids.add(persona.id);
        return [persona];
      });
    }
    const legacyRaw = storage.getItem(LEGACY_PERSONA_STORAGE_KEY);
    if (!legacyRaw) return [];
    const legacy = JSON.parse(legacyRaw) as Record<string, unknown> | null;
    if (!legacy || legacy.version !== 1) return [];
    const persona = parseStoredPersona({ ...legacy, id: typeof legacy.id === "string" && legacy.id.trim() ? legacy.id : "upload-legacy" });
    if (!persona) return [];
    const personas = [persona];
    try { writeLocalPersonas(storage, personas); } catch { return personas; }
    return personas;
  } catch {
    return [];
  }
}
