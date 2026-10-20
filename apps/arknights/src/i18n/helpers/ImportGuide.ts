import zh from "../../../messages/helpers/zh/ImportGuide.json" with { type: "json" };
import en from "../../../messages/helpers/en/ImportGuide.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const localize = createLocalizer(zh, en);
