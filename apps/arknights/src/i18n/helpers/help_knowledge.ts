import zh from "../../../messages/helpers/zh/help_knowledge.json" with { type: "json" };
import en from "../../../messages/helpers/en/help_knowledge.json" with { type: "json" };
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const helpKnowledgeText = createLocalizer(zh, en);
