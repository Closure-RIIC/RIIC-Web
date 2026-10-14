import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { IntlProvider } from "use-intl";
import { LocaleProvider } from "@/i18n/client";
import { getRequestI18n } from "@/i18n/locale";
import { getPublicPageConfig } from "@/server/page-data";
import { TelemetryLoader } from "@/components/telemetry/TelemetryLoader";
import "overlayscrollbars/overlayscrollbars.css";
import "@/app/globals.css";
import { AgentRuntimeProvider } from "@/components/agent/AgentRuntimeProvider";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";

export const Route = createRootRoute({
  beforeLoad: async () => {
    const [{ locale, messages }, publicConfig] = await Promise.all([getRequestI18n(), getPublicPageConfig()]);
    return { locale, messages, publicConfig };
  },
  head: ({ matches }) => {
    const { messages } = matches[0].context;
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
  notFoundComponent: () => <main className="p-8"><h1>404</h1><a href="/">返回首页 / Home</a></main>,
});

function RootDocument() {
  const { locale, messages } = Route.useRouteContext();
  return <html lang={locale === "zh" ? "zh-CN" : "en"} className="antialiased" suppressHydrationWarning>
    <head><HeadContent /></head>
    <body>
      <noscript><div style={{ padding: 24, fontFamily: "sans-serif", lineHeight: 1.6 }}>当前浏览器无法运行页面脚本。请启用 JavaScript，或升级浏览器 / Android System WebView。</div></noscript>
      <IntlProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">
        <LocaleProvider><AgentRuntimeProvider><Outlet /></AgentRuntimeProvider></LocaleProvider>
        <TelemetryLoader />
      </IntlProvider>
      <Scripts />
    </body>
  </html>;
}
