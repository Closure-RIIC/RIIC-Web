import zh from "../../../messages/helpers/zh/local_profiles.json" with { type: "json" };
import en from "../../../messages/helpers/en/local_profiles.json" with { type: "json" };
import { createLocalizer } from "../localize.ts";
export const localProfilesText = createLocalizer(zh, en);
