import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../messages/zh-CN/AK_Raw_routes___root.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_routes___root");
import { HeadContent, Outlet, Scripts, createRootRoute, useHydrated } from "@tanstack/react-router";
import { IntlProvider } from "use-intl";
import { LocaleProvider } from "@/i18n/client";
import { getRequestI18n } from "@/i18n/locale";
import { registerMessages } from "@riic/arknights-domain/i18n/localize";
import { getPublicPageConfig } from "@/server/page-data";
import { TelemetryLoader } from "@/components/telemetry/TelemetryLoader";
import "overlayscrollbars/overlayscrollbars.css";
import "@/app/globals.css";
import { AgentRuntimeProvider } from "@/components/agent/AgentRuntimeProvider";
import { ColorModeController } from "@/components/ColorMode";
import { COLOR_MODE_BOOTSTRAP } from "@/color-mode";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";

export const Route = createRootRoute({
  // Public bootstrap data belongs to this router/request, not a module-global cache.
  // Explicit invalidation (e.g. a language change) refreshes it; navigation reuses it.
  staleTime: Infinity,
  loader: async ({ location }) => {
    const [{ locale, messages }, publicConfig] = await Promise.all([getRequestI18n({ data: { pathname: location.pathname } }), getPublicPageConfig()]);
    return { locale, messages, publicConfig };
  },
  head: ({ loaderData }) => {
    const messages = loaderData?.messages;
    if (!messages) return {};
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { title: messages.Metadata.siteTitle },
        { name: "description", content: messages.Metadata.description },
        { name: "riic-build-id", content: process.env.APP_CLIENT_BUILD_ID ?? "local-development" },
      ],
      links: [{ rel: "icon", href: "/icon.png", type: "image/png" }, { rel: "apple-touch-icon", href: "/apple-icon.png" }],
    };
  },
  component: RootDocument,
  notFoundComponent: NotFoundPage,
});

function RootDocument() {
  const hydrated = useHydrated();
  const { locale, messages } = Route.useLoaderData();
  registerMessages(locale, messages);
  return <html lang={locale} className="antialiased" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOTSTRAP }} /><HeadContent /></head>
    <body inert={!hydrated} data-app-hydrated={hydrated ? "true" : "false"}>
      <noscript><div style={{ padding: 24, fontFamily: "sans-serif", lineHeight: 1.6 }}>{rawText.text(locale, "thisBrowserCannotRunThePageScriptsEnableJavascript")}</div></noscript>
      <IntlProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">
        <ColorModeController />
        <LocaleProvider locale={locale} messages={messages}><AgentRuntimeProvider><Outlet /></AgentRuntimeProvider></LocaleProvider>
        <TelemetryLoader />
      </IntlProvider>
      <Scripts />
    </body>
  </html>;
}


function NotFoundPage() { const rawLocale = useRawLocale(); return <><meta name="robots" content="noindex" /><main className="p-8"><h1>404</h1><a href="/">{rawText.text(rawLocale, "backToHome")}</a></main></>; }
