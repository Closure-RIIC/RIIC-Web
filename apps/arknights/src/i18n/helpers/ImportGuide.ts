import zh from "../../../messages/helpers/zh/ImportGuide.json" with { type: "json" };
import en from "../../../messages/helpers/en/ImportGuide.json" with { type: "json" };
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const localize = createLocalizer(zh, en);
