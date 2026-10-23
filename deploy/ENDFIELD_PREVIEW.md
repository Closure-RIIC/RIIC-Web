# Endfield administrator preview

The production origin is `https://endfield.riic.autos`. The shared game menu
deliberately lists only Arknights, including when opened by an administrator.

## Access boundary

The Endfield runtime checks every page, server function, API and static request
against `/api/platform/endfield-access` on the configured account service.
That service reads the account's current database role and ban state on every
request. Only an active administrator receives a grant. Anonymous, ordinary,
reviewer, deleted, banned and revoked accounts are denied. An unavailable or
misconfigured account service fails closed. Endfield returns a private,
uncacheable HTTP 404 without a login redirect or application shell.

The Nitro runtime plugin wraps static serving; the application entry also
protects development requests. Install `endfield-admin.nginx.conf.example` in the HTTPS virtual host before
exposing the service. Its auth subrequest covers static files as well as
application requests. Do not add a public static-file/CDN location that bypasses
this check. Keep the Endfield runtime on loopback port 4176 and retain the
existing ingress client-IP protections and TLS configuration.

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
cookie. Administrators then open the Endfield URL directly.

Configure the Endfield service with `NODE_ENV=production`, `HOST=127.0.0.1`,
`PORT=4176` and `ENDFIELD_ACCOUNT_ORIGIN=https://riic.autos`. An already deployed
private platform service can instead be selected with `PLATFORM_API_ORIGIN`;
its trusted origin list must contain both application origins. Never expose
that service's trusted-proxy port to the public internet.

## Release and acceptance

Build and stage the Endfield artifact from the same verified commit as the
Arknights release. The existing Arknights deployment does not automatically
start Endfield. Install the independent service, ingress, DNS and TLS, then
verify these boundaries before announcing availability:

- Anonymous and ordinary-account requests to pages, APIs and actual asset URLs
  return 404 with `Cache-Control: private, no-store`.
- A real administrator session loads the application and can use its APIs.
- Revoking or banning that account immediately denies the next server request.
- Neither application's game menu contains an Endfield destination.
- An account-service outage does not expose cached HTML, APIs or assets.

Retain the previous independent artifact for rollback. A rollback must preserve
the ingress access gate; do not restore an unprotected virtual host.
