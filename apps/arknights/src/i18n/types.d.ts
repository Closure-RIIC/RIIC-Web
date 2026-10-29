import type { Messages } from "./message-types";
import type { AppLocale } from "@riic/arknights-domain/i18n/config";
declare module "use-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
