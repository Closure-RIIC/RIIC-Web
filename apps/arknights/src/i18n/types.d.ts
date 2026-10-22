import type messages from "../../messages/zh";
import type { AppLocale } from "@riic/arknights-domain/i18n/config";
declare module "use-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
