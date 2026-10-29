import type Messages from "../../../messages/zh-CN/help_knowledge.json";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const helpKnowledgeText = createLocalizer<typeof Messages>("help_knowledge");
