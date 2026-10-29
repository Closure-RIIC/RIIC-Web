import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { gameHref } from "@riic/shell/games";

export const getChangelogWorkbench = createServerFn({ method: "GET" }).handler(() => {
  const origin = gameHref("arknights", new URL(getRequest().url).origin,
    import.meta.env.VITE_ARKNIGHTS_ORIGIN || process.env.VITE_ARKNIGHTS_ORIGIN || process.env.ENDFIELD_ACCOUNT_ORIGIN);
  const destination = new URL("admin/changelog", origin);
  destination.searchParams.set("application", "endfield");
  return destination.href;
});
