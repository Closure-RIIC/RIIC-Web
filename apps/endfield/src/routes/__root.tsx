import { HeadContent, Outlet, Scripts, createRootRoute, useHydrated } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { WorkspaceProvider } from "../state";
import { AccountProvider } from "../account";
import { getInitialAccountSession } from "../server/session-bootstrap";
import "../styles.css";
import "overlayscrollbars/overlayscrollbars.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): { roster?: boolean } => ({ roster: search.roster === true || search.roster === "true" ? true : undefined }),
  loader: () => import.meta.env.SSR ? getInitialAccountSession() : undefined,
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" }, { title: "帝江号排班 · RIIC Endfield" }] }),
  component: Root,
  notFoundComponent: () => <div className="ef-page"><h1>未找到页面 / Page not found</h1><a href="/">返回排班 / Schedule</a></div>,
});
function Root() {
  const hydrated = useHydrated();
  const initialSession = Route.useLoaderData();
  return <html lang="zh-CN" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: "try{const dark=localStorage.getItem('riic-color-mode')!=='light';document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light'}catch{}" }} /><HeadContent /></head>
    <body inert={!hydrated} data-app-hydrated={hydrated ? "true" : "false"}><WorkspaceProvider><AccountProvider initialSession={initialSession}><AppShell><Outlet /></AppShell></AccountProvider></WorkspaceProvider><Scripts /></body>
  </html>;
}
