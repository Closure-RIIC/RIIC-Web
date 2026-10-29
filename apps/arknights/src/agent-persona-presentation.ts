import { getCatalog } from "@riic/arknights-domain/i18n/localize";
import type { AppLocale } from "@riic/contracts/locale";
import type { AgentPersona } from "./agent-personas.ts";
import type Messages from "../messages/zh-CN/AgentPersonas.json";

/** Display translations never change persona IDs or uploaded user content. */
export function personaPresentation(persona: AgentPersona, locale: AppLocale) {
  const upload = getCatalog<typeof Messages>(locale, "AgentPersonas").upload;
  return persona.kind === "builtin"
    ? getCatalog<typeof Messages>(locale, "AgentPersonas")[persona.id]
    : { name: persona.name || upload.name, description: persona.description || upload.description, caption: "", identity: persona.name || upload.name, welcome: "" };
}
