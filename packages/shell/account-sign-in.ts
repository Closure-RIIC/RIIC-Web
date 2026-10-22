export const ACCOUNT_SIGN_IN_EVENT = "riic:account-sign-in";
export type AccountSignInDetail = { trigger?: HTMLElement | null };

/** Open the app's account dialog without changing the route or carrying credentials. */
export function requestAccountSignIn(trigger?: HTMLElement | null) {
  window.dispatchEvent(new CustomEvent(ACCOUNT_SIGN_IN_EVENT, { detail: { trigger: trigger ?? document.activeElement } }));
}

export function accountDialogRequest(href: string) {
  const url = new URL(href);
  const kind = url.searchParams.get("auth");
  if (kind !== "signin" && kind !== "reset-password") return null;
  const resetToken = kind === "reset-password" ? url.searchParams.get("token")?.trim() ?? "" : undefined;
  for (const key of ["auth", "token", "error"]) url.searchParams.delete(key);
  return { resetToken, cleanHref: `${url.pathname}${url.search}${url.hash}` };
}
