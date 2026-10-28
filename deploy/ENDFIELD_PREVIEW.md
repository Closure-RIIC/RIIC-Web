# Endfield public access and optional preview

The public entry is `https://endfield.riic.autos`, which redirects to
`https://dj.riic.autos`. Both applications list Arknights and Endfield in the
sidebar game menu, including for anonymous visitors.

## Access boundary

Endfield defaults to `ENDFIELD_ACCESS_MODE=public`. Pages and static assets do
not require an account or call the account service for an access grant. Account
operations and Skland synchronization retain their own session, ownership,
same-origin and request-size checks. Responses remain private and uncacheable
because pages can contain session bootstrap data.

For an explicitly private preview, set `ENDFIELD_ACCESS_MODE=admin`. The runtime
then checks every page, server function, API and static request
against `/api/platform/endfield-access` on the configured account service.
That service reads the account's current database role and ban state on every
request. Only an active administrator receives a grant. Anonymous, ordinary,
reviewer, deleted, banned and revoked accounts are denied. An unavailable or
misconfigured account service fails closed. Endfield returns a private,
uncacheable HTTP 404 without a login redirect or application shell.

The Nitro plugin and application entry both apply this mode. Public ingress
must remove the site-wide administrator `auth_request`; the example
`endfield-admin.nginx.conf.example` is only for optional private previews.
Keep the runtime on loopback, preserve TLS and client-IP protections, and keep
the existing Skland bridge's same-origin check when removing its administrator
subrequest. Session validation still occurs in the upstream Skland API.

## Account configuration

The existing account service remains authoritative; no separate database or
credential store is created. Configure its existing authentication environment:

```dotenv
BETTER_AUTH_URL=https://riic.autos
PLATFORM_PUBLIC_ORIGINS=https://riic.autos,https://endfield.riic.autos
AUTH_COOKIE_DOMAIN=riic.autos
```

Only enable the shared domain when all of its subdomains are trusted. Existing
host-only sessions may need a new login on Arknights to receive the shared
cookie. Public tools remain usable without a login.

Configure the Endfield service with `NODE_ENV=production`, `HOST=127.0.0.1`,
`PORT=4186`, `ENDFIELD_ACCESS_MODE=public` and `ENDFIELD_ACCOUNT_ORIGIN=https://riic.autos`. An already deployed
private platform service can instead be selected with `PLATFORM_API_ORIGIN`;
its trusted origin list must contain both application origins. Never expose
that service's trusted-proxy port to the public internet.

## Release and acceptance

Build and stage the Endfield artifact from the same verified commit as the
Arknights release. The existing Arknights deployment does not automatically
start Endfield. Install the independent service, ingress, DNS and TLS, then
verify these boundaries before announcing availability:

- Anonymous and ordinary-account requests to pages and actual asset URLs return 200.
- Ordinary users can sign in and synchronize their own Skland accounts; missing
  or invalid sessions cannot read private account data, and cross-origin writes fail.
- Both applications' top game menus navigate in both directions on desktop and mobile.
- An account-service outage leaves public tools available while private API requests fail.
- `accessMode: "public"` in the release artifact requires a 200 HTML health probe;
  update the root-owned installer before deploying the first public artifact.

Retain the previous independent artifact for rollback. Legacy artifacts keep
their runtime administrator gate and are verified with the original anonymous
404 probe. The installer checks the live process's release directory for both modes.
