# Known Issues - code audit findings

Pre-existing bugs and hardening gaps from a multi-agent code audit. This scaffold was later
converted to **Stellar-only**: the many earlier findings that concerned the removed chains
(EVM/Solana/TRON/XRPL) and their tooling (Xaman/XUMM, Ledger, Binance, the walletbook) are gone with
that code and are no longer listed here. What remains below is what still applies to the surviving
subsystems: the Partner API, the wallet session / IDOR, rate-limiting, KYC, config integrity,
accessibility, and Stellar itself.

**Severity:** 🔴 High = wrong funds / broken core flow / auth bypass · 🟠 Medium = security or
correctness gap with real impact · ⚪ Low = latent bug, dead code, or quality issue.

> When you fix one, remove it here (or mark it fixed with the commit), and update the doc block that
> describes that subsystem if behavior changes.

---

## ✅ Security fail-closed pass (2026-08-02)

A focused pass on the security defaults ahead of ecosystem forks. Local gate green (typecheck, tests,
lint, build).

- **NEW-H1 (no fail-closed prod guard) - FIXED.** `instrumentation.ts` +
  `lib/env.ts#assertProductionEnv` throw at boot when `NODE_ENV=production` and `APP_SESSION_SECRET`
  is missing/short (so the BUG-H3 legacy fallback can't reach prod).
- **BUG-M1 (XFF spoofing) - FIXED.** `lib/server/rateLimit.ts#clientIp` no longer trusts the leftmost
  XFF entry; prefers `TRUSTED_CLIENT_IP_HEADER`, else the nearest trusted hop (`TRUSTED_PROXY_COUNT`
  from the right).
- **`clientIp` fail-safe.** If `TRUSTED_PROXY_COUNT` exceeds the actual XFF hop count (misconfig), it
  ignores the XFF and falls back to `x-real-ip` with a warning instead of clamping to the leftmost
  (spoofable) entry, which would silently re-open BUG-M1. (`tests/rateLimit.test.ts`)
- **NEW (no security headers) - FIXED.** `next.config.mjs` adds `frame-ancestors 'none'` /
  `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`.
- Added `SECURITY.md`.

> **Open residual:** the multi-proxy default (`TRUSTED_PROXY_COUNT=1`) can collapse anonymous
> requests behind an unexpected proxy chain to one rate-limit bucket - configure it to your infra.

---

## ✅ KYC identity binding (2026-08-02)

- **NEW-H2 / NEW-M1 (KYC anonymous PII + IDOR) - FIXED.** `natural-person` and `legal-person` now
  derive `externalUserId` from the proven wallet session (`requireKycIdentity`), ignoring the
  client-supplied value in secure mode; the session status/sync routes require a wallet session
  (`requireSession`). Added format validation (`lib/partner/kycValidation.ts`: CPF/CNPJ checksum,
  email, ISO date). Client `useKyc` establishes the session first (mirrors `useCashin`).
  > **Residual:** without server-side persistence the status/sync routes can't bind a specific
  > `sessionId` to its owner - this closes anonymous access, not IDOR by a known `sessionId`. Add a
  > `sessionId → address` store for full ownership binding.
- **KycLegalPersonForm** owners list uses stable `uid` keys (was index-keyed - removing a middle
  owner remapped the others' state).

---

## ✅ Config integrity (2026-08-02)

- **Two asset-config systems / wrong chainIds - FIXED.** `lib/constants/defaultAssets.ts` is now
  **derived** from `configs/gateway-config.json` (single source), removing the hand-maintained copies
  that carried wrong `chainId`s. A missing symbol throws at load. `tests/config-integrity.test.ts`
  locks defaults↔catalog consistency.
- **Untyped gateway config - IMPROVED.** Removed the `@ts-ignore` in `lib/gatewayConfig.ts`; added
  `getAssetBySymbol`; `tests/config-integrity.test.ts` asserts config invariants (unique chain/asset
  ids, valid `symbol`/`address`/`decimals`, known `tokenVariant`) so bad edits fail the build.

---

## ✅ Accessibility + design-token foundation (2026-08-02)

Ganhos de acessibilidade (verificáveis sem browser) + fundação de tokens.

- **Labels associados aos inputs - FIXED.** `components/partner/kyc/fields.tsx` gera `id` via
  `useId()` e liga `htmlFor`/`id`. Propaga a todos os forms de KYC/KYB e aos cards de cash.
- **Foco visível por teclado - FIXED.** `app/globals.css` adiciona um `:where(...):focus-visible`
  global (botões, links, inputs, `.wallet-tile`, `[role=button]`).
- **Focus-trap no ConnectModal - FIXED.** Foco inicial + trap `focusin` + restauração do foco ao
  fechar. Antes só tratava Escape; o teclado escapava do modal. (A restauração não rouba o foco de
  volta quando o modal do Stellar Wallets Kit assume no handoff.)
- **Emojis decorativos ocultados de AT** (`aria-hidden`).
- **`<form>` semântico.** Os formulários (KYC PF/PJ, cash-in, cash-out) são `<form onSubmit>` reais:
  Enter submete a ação primária, landmark de formulário, e botões com `type` explícito.
- **Tokens de design.** `globals.css` tem tokens semânticos (`--success`/`--danger`/`--warning`/
  `--info`), `--input-bg`, raios e uma escala de z-index nomeada.

> Ainda aberto (P2/P3): light theme completo (exige varrer os estilos inline dos componentes para
> tokens antes de habilitar `prefers-color-scheme`); erros de validação inline por campo
> (`aria-invalid`/`aria-describedby`) - hoje a validação é via toast; i18n.

---

## 🔴 High

### BUG-H3 - Partner routes: no proof-of-wallet-ownership (spoofable `sender` / IDOR) - **FIXED (secure mode)**
**Location:** `app/api/partner/**` (`cashin/{quote,intent}`, `cashout/{quote,intent}`, status GETs)
+ `lib/partner/partnerClient.ts`
The cash-in/out routes used to take a client-supplied `sender` pubkey (only length-checked), then
`mintUserJwt(sender)` minted a partner Bearer JWT for it - **no route verified caller identity**, so
any caller could act as any provisioned wallet (open charges/intents attributed to another pubkey,
read their status by id).
**Fix (shipped):** a **wallet session with proof-of-ownership** (`lib/server/partnerSession.ts` +
`app/api/partner/session*`). The wallet signs a server challenge; the server verifies the Stellar
Ed25519 signature (`verifyStellarSignature`) and issues an httpOnly session cookie
(`pf_partner_session`, HS256, `sub=address`). **Every** JWT-authed route (cash-in + cash-out, quote +
intent + status) now calls `requireSender(req, clientSender)` and derives the trusted `sender` from
the verified session - mismatch → 403, missing → 401. Client: `lib/partner/session.ts` +
`useCashout`/`useCashin` (`ensureSession`, one signature/hour); session auto-cleared on wallet
disconnect (`HeaderWithConnect`). See `docs/04-partner-api.md` → *Wallet session*.
**Gated by `APP_SESSION_SECRET`:** enforced when set (production); in dev (unset) the routes fall
back to the client `sender` with a warning so the local demo still runs. **Set the secret in
production.**
**Remaining follow-up:** **Albedo** doesn't expose a verifiable message signature, so its secure-mode
login isn't wired yet (Freighter / Lobstr / xBull / Hana are). The challenge is stateless (signed
nonce, no server-side single-use store) - fine for the scaffold.

---

## 🟠 Medium

### BUG-M1 - Rate limit keyed on spoofable `X-Forwarded-For` - ✅ FIXED (2026-08-02)
**Location:** `lib/server/rateLimit.ts` (also via `lib/partner/routeHelpers.ts`)
`clientIp()` used to return the **leftmost** XFF entry, which the client fully controls. Rotating the
header gave a fresh bucket per request, defeating the per-IP limits - the only abuse control on the
unauthenticated partner routes.
**Fix:** derive the IP from a trusted hop (rightmost XFF after N known proxies, or the platform's
connecting-IP header) and strip inbound XFF at the edge. See the security pass above.

### BUG-M3 - Stellar long-memo build (client-side fallback) - ✅ REMOVED
Obsolete: the client no longer builds the memo. The Partner API decides `MEMO_TEXT` vs `MEMO_HASH`
and sends the authoritative value; the client only **validates** it before signing. `validateMemo`
(`lib/chains/stellar/stellarHelpers.ts`) already measures `MEMO_TEXT` in **bytes**
(`Buffer.byteLength`, max 28) and requires `MEMO_HASH` to be a 32-byte hex value, and `buildMemo`
(`lib/actions/stellar-actions.ts`) hex-decodes it. The old invalid-`MEMO_HASH` / char-vs-byte fallback
in `InstructionInterpreter.ts` was deleted with the client-side interpreter.

---

## ⚪ Low

### BUG-L1 - Secret module missing `import 'server-only'`
**Location:** `lib/env.ts` (partner secret / `APP_SESSION_SECRET`)
`lib/env.ts` reads secrets but lacks the compile-time guard the other secret modules carry
(`lib/partner/{hmacSigner,jwtCache,partnerClient,routeHelpers}.ts`, `lib/server/partnerSession.ts`).
No live leak today (reached only via `app/api/*`), but the promised defense-in-depth is absent.
Already noted as a gap in `docs/03`.
**Fix:** add `import 'server-only'` as the first import.

---

## Partner-API alignment review - cash-in / cash-out / KYC

End-to-end cross-check of the money/identity flows against the partner-api contract.

### NOTE-C1 - Cash-in delivery is legacy on Stellar (resolved)
**Location:** `hooks/useCashin.ts`, `components/actions/CashinCard.tsx`
The partner **validates `destinationWallet` against the asset's chain** (`cashin.service.ts`
`isValidDestinationForChain` accepts only EVM `0x…` and Solana base58; the `default` case, which
includes Stellar, returns `false`), so an on-chain `destinationWallet` would **throw 400** on the
quote. `useCashin` therefore **omits `destinationWallet`** and takes the **legacy path**: a paid Pix
emits `CASHIN_COMPLETED` and an operator backend credits the crypto out-of-band. `CashinCard` shows
no network/asset selector - it's a value-only Pix charge. `RequestQuoteInput` still accepts an
optional `destinationWallet`, but the Stellar card never sets it.

### BUG-H18 - KYB (PJ / legal-person) has no active provider upstream → always 503 (⚠ partner-side, open)
**Location:** `components/partner/kyc/KycLegalPersonForm.tsx`, `app/api/partner/kyc/legal-person/route.ts`
The scaffold ships a complete PJ/KYB flow (form + proxy route + types), but the partner-api has **no
active PJ provider**: BigDataCorp declines legal-person and Celcoin is runtime-disabled, so
`POST /users/kyc/sessions/legal-person` **always returns 503**. The KYB flow cannot complete
end-to-end today. **Fix (not in scaffold's control):** the partner must enable a PJ provider; until
then, treat KYB as unavailable (documented in `docs/04-partner-api.md`). PF (natural-person) works,
**BR only**.
> **Now surfaced in the UI.** `KycLegalPersonForm` opens with a warning banner (`LookupNotice`
> `variant="warn"`) saying the submit is unavailable, so the user does not fill the whole company
> plus the ownership structure only to hit a 503 at the end. The **CNPJ lookup on the same tab does
> work** and is genuinely useful today (autofill + cadastral summary), which is why the tab stays
> enabled instead of being hidden. Remove the banner when a PJ provider goes live.
