import type { Page } from "@playwright/test";

const installed = new WeakSet<Page>();

export async function installMockSessionRefresh(page: Page) {
  if (installed.has(page)) return;
  installed.add(page);
  // Browser route mocks cannot intercept the server's initial session read.
  // Exercise the normal focus revalidation after hydration so these isolated
  // interaction fixtures consume their mocked session without changing SSR.
  await page.addInitScript(() => {
    let refreshed = false;
    const observer = new MutationObserver(refresh);
    function refresh() {
      if (refreshed || !document.querySelector('[data-workbench-hydrated="true"]')) return;
      refreshed = true;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("focus"))));
    }
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-workbench-hydrated"] });
    refresh();
  });
}
