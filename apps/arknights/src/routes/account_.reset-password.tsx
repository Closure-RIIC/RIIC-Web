import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/account_/reset-password")({
  beforeLoad: ({ location }) => {
    const previous = new URLSearchParams(location.searchStr);
    const next = new URLSearchParams({ auth: "reset-password" });
    for (const key of ["token", "error"]) {
      const value = previous.get(key);
      if (value) next.set(key, value);
    }
    throw redirect({ href: `/?${next}`, replace: true });
  },
});
