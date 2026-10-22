import zh from "../../../messages/helpers/zh/AuthValidation.json" with { type: "json" };
import en from "../../../messages/helpers/en/AuthValidation.json" with { type: "json" };
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const localize = createLocalizer(zh, en);
