import zh from "../../../messages/helpers/zh/App.json" with { type: "json" };
import en from "../../../messages/helpers/en/App.json" with { type: "json" };
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const localize = createLocalizer(zh, en);
