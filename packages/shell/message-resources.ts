import type { AbstractIntlMessages } from "use-intl";
import type { AppLocale } from "@riic/contracts/locale";

/** Per-renderer resource requests; no user locale or business state is global. */
export function createMessageResources(loader: (locale: AppLocale, namespaces: string[]) => Promise<AbstractIntlMessages>) {
  const requests = new Map<string, Promise<AbstractIntlMessages>>();
  const catalogs = new Map<AppLocale, AbstractIntlMessages>();
  const requested = new Set<string>();
  const keyFor = (locale: AppLocale, namespaces: readonly string[]) => `${locale}:${[...new Set(namespaces)].sort().join(",")}`;
  return {
    seed(locale: AppLocale, messages: AbstractIntlMessages) {
      catalogs.set(locale, { ...catalogs.get(locale), ...messages });
      for (const name of Object.keys(messages)) requested.add(name);
    },
    requested: () => [...requested],
    request: (locale: AppLocale, namespaces: readonly string[]) => requests.get(keyFor(locale, namespaces)),
    read(locale: AppLocale, namespaces: readonly string[]) {
      for (const name of namespaces) requested.add(name);
      const cached = catalogs.get(locale);
      return cached && namespaces.every(name => Object.hasOwn(cached, name)) ? cached : undefined;
    },
    load(locale: AppLocale, namespaces: readonly string[]) {
      for (const name of namespaces) requested.add(name);
      const names = [...new Set(namespaces)].sort();
      const key = keyFor(locale, names);
      let pending = requests.get(key);
      if (!pending) {
        pending = loader(locale, names).then(messages => {
          catalogs.set(locale, { ...catalogs.get(locale), ...messages });
          return messages;
        }).catch(error => { requests.delete(key); throw error; });
        requests.set(key, pending);
      }
      return pending;
    },
  };
}
