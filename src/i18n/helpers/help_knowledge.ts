import zh from "../../../messages/helpers/zh/help_knowledge.json" with { type: "json" };
import en from "../../../messages/helpers/en/help_knowledge.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const helpKnowledgeText = createLocalizer(zh, en);
