// Pure presentation tests load the same resources as their application boundary.
import { APP_LOCALES } from "@riic/contracts/locale";
import { loadMessages } from "./messages.ts";
await Promise.all(APP_LOCALES.map(locale => loadMessages(locale)));
