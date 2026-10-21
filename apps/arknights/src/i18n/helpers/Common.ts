import zh from "../../../messages/helpers/zh/Common.json" with { type: "json" };
import en from "../../../messages/helpers/en/Common.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const localize = createLocalizer(zh, en);
