import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../messages/zh-CN/EF_Raw_routes___root.json";
const rawText = createRawLocalizer<typeof RawMessages>("EF_Raw_routes___root");
import { HeadContent, Outlet, Scripts, createRootRoute, useHydrated } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { WorkspaceProvider } from "../state";
import { AccountProvider } from "../account";
import { getInitialAccountSession } from "../server/session-bootstrap";
import { getRequestI18n } from "../i18n/server";
import { EndfieldLanguageProvider, useEndfieldLanguage } from "../i18n/client";
import "../styles.css";
import "overlayscrollbars/overlayscrollbars.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";

export const Route = createRootRoute({
  // Keep the request's bootstrap resources across navigation. Language changes
  // explicitly invalidate the router; feature boundaries load each page's text.
  staleTime: Infinity,
  validateSearch: (search: Record<string, unknown>): { roster?: boolean } => ({ roster: search.roster === true || search.roster === "true" ? true : undefined }),
  loader: async ({ location }) => {
    const [i18n, session] = await Promise.all([getRequestI18n({ data: { pathname: location.pathname } }), import.meta.env.SSR ? getInitialAccountSession() : undefined]);
    return { ...i18n, session };
  },
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" }] }),
  component: Root,
  notFoundComponent: NotFoundPage,
});
function Root() {
  const { locale, messages } = Route.useLoaderData();
  return <EndfieldLanguageProvider initialLocale={locale} initialMessages={messages}><RootDocument /></EndfieldLanguageProvider>;
}
function RootDocument() {
  const hydrated = useHydrated();
  const { session: initialSession } = Route.useLoaderData();
  const { locale } = useEndfieldLanguage();
  return <html lang={locale} style={{ colorScheme: "light" }} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: "try{const dark=localStorage.getItem('riic-color-mode')==='dark';document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light'}catch{}" }} /><HeadContent /></head>
    <body inert={!hydrated} data-app-hydrated={hydrated ? "true" : "false"}><WorkspaceProvider><AccountProvider initialSession={initialSession}><AppShell><Outlet /></AppShell></AccountProvider></WorkspaceProvider><Scripts /></body>
  </html>;
}


function NotFoundPage() { const rawLocale = useRawLocale(); return <div className="ef-page"><h1>{rawText.text(rawLocale, "pageNotFound")}</h1><a href="/">{rawText.text(rawLocale, "backToSchedule")}</a></div>; }
