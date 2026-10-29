import type Messages from "../../../messages/zh-CN/components.json";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
export const localize = createLocalizer<typeof Messages>("components");
