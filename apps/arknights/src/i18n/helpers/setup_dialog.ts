import zh from "../../../messages/helpers/zh/setup_dialog.json" with { type: "json" };
import en from "../../../messages/helpers/en/setup_dialog.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const localize = createLocalizer(zh, en);
