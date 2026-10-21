import zh from "../../../messages/helpers/zh/OperatorPresentation.json" with { type: "json" };
import en from "../../../messages/helpers/en/OperatorPresentation.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const localize = createLocalizer(zh, en);
