import type messages from "../../messages/zh";
import type { AppLocale } from "./config";
declare module "use-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
