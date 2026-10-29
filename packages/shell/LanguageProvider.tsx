"use client";

import { createContext, lazy, Suspense, use, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { IntlProvider, useMessages, type AbstractIntlMessages } from "use-intl";
import { isAppLocale, parseLocale, type AppLocale } from "@riic/contracts/locale";
import { getCatalog, registerMessages } from "@riic/arknights-domain/i18n/localize";
import { PrimitiveLabelsProvider, type PrimitiveLabels } from "@riic/ui-primitives/labels";
import { createMessageResources } from "./message-resources.ts";

declare module "use-intl" { interface AppConfig { Locale: AppLocale } }

type Language = { locale: AppLocale; pending: boolean; error: boolean; setLocale: (locale: AppLocale) => Promise<boolean> };
const LanguageContext = createContext<Language | null>(null);
const ResourcesContext = createContext<ReturnType<typeof createMessageResources> | null>(null);

export function LanguageProvider({ initialLocale, initialMessages, cookieName, legacyStorage, loadMessages, onLocaleChange, children }: {
  initialLocale: AppLocale;
  initialMessages: AbstractIntlMessages;
  cookieName: string;
  legacyStorage?: string;
  loadMessages: (locale: AppLocale, namespaces: string[]) => Promise<AbstractIntlMessages>;
  onLocaleChange?: () => void;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState({ locale: initialLocale, messages: initialMessages });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const [resources] = useState(() => createMessageResources(loadMessages));
  resources.seed(initialLocale, initialMessages);
  const setLocale = useCallback(async (locale: AppLocale) => {
    if (!isAppLocale(locale)) return false;
    const request = ++sequence.current;
    setPending(true);
    setError(false);
    try {
      // Include any feature opened while this language request was in flight.
      let messages: AbstractIntlMessages = {};
      for (;;) {
        const names = resources.requested();
        messages = { ...messages, ...await resources.load(locale, names) };
        if (request !== sequence.current) return false;
        if (resources.requested().every(name => Object.hasOwn(messages, name))) break;
      }
      registerMessages(locale, messages);
      document.cookie = `${cookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      setSnapshot({ locale, messages });
      onLocaleChange?.();
      return true;
    } catch {
      if (request === sequence.current) setError(true);
      return false;
    } finally {
      if (request === sequence.current) setPending(false);
    }
  }, [cookieName, resources, onLocaleChange]);
  useEffect(() => {
    document.documentElement.lang = snapshot.locale;
  }, [snapshot.locale]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const explicit = url.searchParams.has("ui_locale");
    if (explicit) {
      url.searchParams.delete("ui_locale");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!legacyStorage || explicit || document.cookie.split(";").some(value => value.trim().startsWith(`${cookieName}=`))) return;
    try {
      const legacy = parseLocale(localStorage.getItem(legacyStorage));
      if (legacy) void setLocale(legacy).then(success => { if (success) localStorage.removeItem(legacyStorage); });
    } catch { /* Disabled storage must not prevent using the page. */ }
  }, [cookieName, legacyStorage, setLocale]);
  // Hydration receives serialized resources rather than executing the server's loader.
  registerMessages(snapshot.locale, snapshot.messages);
  const value = useMemo(() => ({ locale: snapshot.locale, pending, error, setLocale }), [snapshot.locale, pending, error, setLocale]);
  // Preserve the nested provider's independent message identity (manual draft combobox regression).
  return <LanguageContext.Provider value={value}><ResourcesContext.Provider value={resources}>
    <IntlProvider locale={snapshot.locale} messages={{ ...snapshot.messages }} timeZone="Asia/Shanghai"><PrimitiveLabelsProvider labels={getCatalog<PrimitiveLabels>(snapshot.locale, "Interface")}>{children}</PrimitiveLabelsProvider></IntlProvider>
  </ResourcesContext.Provider></LanguageContext.Provider>;
}

/** Suspends only a newly opened feature; a language change preloads every requested feature. */
export function MessageBoundary({ namespaces, children }: { namespaces: readonly string[]; children: ReactNode }) {
  const { locale } = useLanguage();
  const resources = useContext(ResourcesContext);
  const parent = useMessages();
  if (!resources) throw new Error("Missing message resource provider");
  const available = resources.read(locale, namespaces);
  // A suspended render must resume through the same promise even after its
  // catalogs enter the cache. Seeded SSR resources can still render synchronously.
  const request = resources.request(locale, namespaces);
  const messages = request ? use(request) : available ?? use(resources.load(locale, namespaces));
  registerMessages(locale, messages);
  return <IntlProvider locale={locale} messages={{ ...parent, ...messages }} timeZone="Asia/Shanghai">{children}</IntlProvider>;
}

export function createMessageComponents(features: Record<string, readonly string[]>) {
  function withMessages<P extends object>(Component: ComponentType<P>, feature: string) {
    const namespaces = features[feature];
    if (!namespaces) throw new Error(`Unknown translation feature: ${feature}`);
    return function LocalizedFeature(props: P) {
      return <Suspense fallback={null}><MessageBoundary namespaces={namespaces}><Component {...props} /></MessageBoundary></Suspense>;
    };
  }
  // Match React.lazy's inference so Promise.then's rejection branch cannot infer never props.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function lazyWithMessages<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>, feature: string) {
    return lazy(async () => ({ default: withMessages<ComponentProps<T>>((await loader()).default, feature) }));
  }
  return { withMessages, lazyWithMessages };
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("Missing language provider");
  return context;
}
