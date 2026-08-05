# 03 - Server API & Security

Everything under `app/api/*` runs on the Next server (App Router route handlers). This is where
secrets live and where all cross-origin/abuse hardening happens. **Client code never talks to
upstreams or holds secrets directly** - it calls these routes. In this Stellar-only scaffold the only
server routes are the PagFinance Partner API proxies; there are no RPC proxies (Stellar reads go
straight to Horizon from the client).

## The `server-only` boundary

Modules that hold secrets or Node-only APIs mark themselves with `import 'server-only'`, which makes
the build **throw if they are ever pulled into a client bundle**. The modules that actually carry
this guard are `lib/partner/hmacSigner.ts`, `lib/partner/partnerClient.ts`, `lib/partner/jwtCache.ts`,
`lib/partner/routeHelpers.ts`, and `lib/server/partnerSession.ts`.

> **Known gap (verified):** `lib/env.ts` also reads secrets (`PARTNER_RAW_SECRET` /
> `APP_SESSION_SECRET`) but does **not** currently `import 'server-only'` - it is protected only by
> convention (reached solely through `app/api/*`). See `BUG-L1` in
> [`known-issues`](known-issues.md). Also note `lib/partner/` is **not** wholly server-only:
> `lib/partner/browserClient.ts` is a **browser** module (it calls the `/api/partner/*` routes), so
> never treat the folder as a unit.

- Never import a `server-only` module from a `'use client'` file. Reach it through an `app/api/*`
  route instead.
- In Vitest this boundary is stubbed via an alias (`server-only` → `tests/stubs/server-only.ts`) so
  server modules can be unit-tested under Node.

## Route inventory (`app/api/*`)

| Route | Purpose |
|-------|---------|
| `partner/*` | PagFinance Partner API proxies (cash-in / cash-out / KYC / price / session) - see [`04`](04-partner-api.md) |

There are no other server routes: no RPC proxy, no wallet-specific auxiliary routes. Stellar balance
/ account reads are done client-side against Horizon (`lib/chains/stellar/horizonClient.ts`).

## CORS - `lib/server/cors.ts`

Locked to a single origin: if `NEXT_PUBLIC_PROJECT_URL` is set, only that origin gets
`Access-Control-Allow-Origin`; otherwise no ACAO header is emitted (same-origin needs none,
cross-origin is denied). Use `corsHeaders()` on responses and `corsPreflightHeaders()` on `OPTIONS`.
The app's own calls are same-origin.

## Rate limiting - `lib/server/rateLimit.ts`

Fixed-window, in-memory counter keyed by e.g. IP. `rateLimit(key, limit, windowMs)` returns
`{ ok, remaining, resetAt }`; `now` is injectable for tests. `lib/partner/routeHelpers.ts` applies it
per partner route (`partner:<bucket>:<ip>`).

`clientIp(req)` is **anti-spoof** (BUG-M1 fixed): it no longer trusts the leftmost, client-controlled
`x-forwarded-for` entry. Resolution order: `TRUSTED_CLIENT_IP_HEADER` (an authoritative edge header,
e.g. `cf-connecting-ip`) → the nearest trusted hop in XFF (`TRUSTED_PROXY_COUNT` from the right,
default 1) → `x-real-ip`. Configure these to match your infra, and make sure the edge **rewrites** the
inbound XFF. See `.env.example`.

> ⚠️ **Scaffold limitation:** the buckets live in `globalThis` (per-instance). This does **not**
> work across multiple instances - swap for Redis/KV (same interface) before horizontal scaling.

## Production preflight - `instrumentation.ts`

Next calls `register()` once at server boot; it runs `assertProductionEnv()` (`lib/env.ts`), which
**throws and stops the boot** when `NODE_ENV=production` and `APP_SESSION_SECRET` is missing/short.
This makes the BUG-H3 dev fallback (trusting the client `sender`) **unreachable in production** -
fail-closed instead of a silent `console.warn`.

## Security headers - `next.config.mjs`

An `async headers()` applies to every response: `Content-Security-Policy: frame-ancestors 'none'` +
`X-Frame-Options: DENY` (anti-clickjacking of connect/sign/cash-out), `Strict-Transport-Security`
(HSTS), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## Wallet session token - `lib/server/partnerSession.ts`

The proof-of-ownership wallet session (challenge → sign → cookie) lives here. It issues a **HS256
JWT** session token (1h TTL, `sub=address`) signed with `APP_SESSION_SECRET` (min 16 chars), stored
in the httpOnly `pf_partner_session` cookie. Every JWT-authed partner route derives the trusted
`sender` from this session instead of a client-supplied field, closing the IDOR (BUG-H3). The
signature verification is Stellar-only (`verifyWalletSignature` → `verifyStellarSignature`). Without
a valid secret, `sessionConfigured()` is false and the routes fall back to the client `sender` with a
warning (dev only). Full flow in [`04`](04-partner-api.md#wallet-session---proof-of-ownership-closes-bug-h3).

## Partner HMAC signing - `lib/partner/hmacSigner.ts`

Used by the Partner API client for machine-to-machine calls (details in [`04`](04-partner-api.md)):

```
signingKey = SHA256(rawSecret + ":" + partnerId)                       (hex)
canonical  = METHOD \n PATH(no query) \n TIMESTAMP \n NONCE \n SHA256(BODY)
signature  = HMAC-SHA256(signingKey, canonical)                        (hex)
Authorization: HMAC-SHA256 partnerId=…,timestamp=…,nonce=…,signature=…
```

Key correctness points, all in `signedFetch`:
- The body is serialized **once** and the same string is used for both the hash and the fetch body
  (avoids reserialization drift vs. the server).
- The query string is stripped from the canonical `path` but kept on the actual URL.
- If `extraHeaders` already carries an `Authorization` (a user Bearer JWT), the HMAC header is
  **omitted** - that endpoint is JWT-authed, not HMAC-authed.
- `server-only`: it handles the partner `rawSecret` and must never enter a browser bundle.
