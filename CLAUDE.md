# CLAUDE.md

Operational guide for AI agents working in ramp-scaffold (PagFinance).

## Git authority (HARD RULE)

- Do not run `git` or `gh` write operations (tag, merge, rebase, reset,
  open PRs) unless the user explicitly asks in that moment. Otherwise make the change, leave it
  unstaged, and report what changed. There is no standing permission to commit.
- Never hand-edit the generated file `lib/wallets/walletbook.json`. Edit the sources in
  `data/wallet-sources/`, then run `npm run build:walletbook`.

## What this is

Next.js 15 (App Router) multiwallet connector scaffold for PagFinance. Central abstraction: every
wallet (EVM, Solana, XRPL, Stellar, TRON, Ledger, Binance) normalizes to one `WalletSlice`
(`lib/types/WalletSlice.ts`), aggregated by `hooks/useWalletWeb3.ts`, so nothing branches on which
backend produced a signature. It also runs server-only proxies under `app/api/*`: EVM/XRPL RPC plus
the PagFinance Partner API (cash-in, cash-out, KYC).

## Layering (mental model)

```
components/* (UI, React + TanStack Query)
  -> hooks/useWalletWeb3 (+ hooks/useCashout)           picks active chain, signs/sends
  -> lib/chains/<id>/useSlice.ts                        one normalized WalletSlice per chain
  -> lib/actions/<chain>-actions.ts                     real signing/transfer per backend
  -> app/api/*                                          server routes: RPC proxies + Partner API + secrets
```

The transaction payload is built by the Partner API (`app/api/partner/*`), not the client:
`hooks/useCashout.ts` takes the API-built instruction and hands it to the active wallet by
capability. `lib/chains/registry.ts` (`CHAIN_ORDER`) is the single source of truth: the guard
(`SingleConnectionGuard`) and `useWalletWeb3` derive from it.
`ConnectModal` is hand-wired per chain. `CHAIN_ORDER` must exactly cover the `ChainId` union
(`lib/types/ChainTypes.ts`); `tests/registry.test.ts` fails the build if they diverge.

## Commands

| Command | Purpose |
|---------|---------|
| `npm i && cp .env.example .env.local` | install, then fill env |
| `npm run dev` | next dev, http://localhost:3000 |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` (`lint:fix`) | next lint |
| `npm run test` (`test:watch`) | vitest |
| `npm run build` | next build |
| `npm run build:walletbook` | regenerate `lib/wallets/walletbook.json` from `data/wallet-sources/` |
| `npm run gen:chain -- <id>` | scaffold a new chain module (skeleton + manual checklist); see `docs/adding-a-chain.md` |

Pre-PR and CI gate, in order: `typecheck`, `lint`, `test`, `build` (per CONTRIBUTING.md). Package
manager is npm (`package-lock.json`), Node 20+. A Husky pre-commit runs lint-staged (`eslint --fix`
plus `prettier`).

## Conventions (verified in repo)

- TypeScript strict with `verbatimModuleSyntax` on (`tsconfig.json`): use `import type` for
  type-only imports.
- Prettier is authoritative (`.prettierrc`): `semi:false`, `singleQuote:true`, `printWidth:100`,
  `tabWidth:2`, `trailingComma:all`. Prettier ignores `*.md`, so docs have no format gate.
- Path alias `@/*` maps to the repo root (`tsconfig.json`, mirrored in `vitest.config.ts`).
- Never fetch ad-hoc from a `useEffect`. TanStack Query v5 is installed and `QueryClientProvider` is
  mounted (`app/providers.tsx`), but **no hook uses it today** - verify before claiming otherwise.
  The actual pattern for every Partner API flow is an **imperative hook with local state**:
  `useCashin`, `useCashout`, `useKyc`, `useKycLookup` all expose `{ busy, error, data, <action>(),
  reset() }` and are driven by a user action, not by render. Follow the sibling hook when adding
  one; reach for TanStack Query when you introduce genuinely derived/cached server state.
- Do not call a wallet SDK (wagmi, solana/tron adapters, xrpl) directly from a component. Go through
  the chain `useSlice`; reach server code only via `app/api/*`.
- Secrets stay server-side: server modules start with `import 'server-only'` (present in
  `lib/partner/hmacSigner.ts`, `jwtCache.ts`, `partnerClient.ts`, `routeHelpers.ts`,
  `lib/server/appToken.ts`, and `lib/server/partnerSession.ts`). The Partner HMAC secret and Xaman
  keys are used only inside `app/api/*`.
- Partner cash-in/out routes never trust a client-supplied `sender`: they call
  `requireSender(req, …)`, which derives the trusted pubkey from the verified wallet-session cookie
  (`lib/server/partnerSession.ts`, gated by `APP_SESSION_SECRET`; dev falls back with a warning).
  See `docs/04-partner-api.md` → *Wallet session*.
- Names must not lie: an EVM network name (`base`, `arb`, `polygon`) is not a `ChainId` (every EVM
  network maps to `'evm'`). Keep `submitTransfer` (req-based, TRON/XRPL) and `submitTransferInterpret`
  (response-based, Solana/EVM/Stellar) distinct.
- Language: comments, UI copy, and error strings are pt-BR; identifiers are English.
- Styling: plain CSS (`app/globals.css`) plus inline styles; reuse the shared classes (`.card`,
  `.btn`, `.pf-input`). No Tailwind config is present.
- **Consume design tokens, never raw hex.** `:root` in `app/globals.css` carries the PagFinance
  brand palette (teal `--primary: #00d4aa` on navy `--bg: #090a17`, taken from the `pagcrypto`
  theme on pag.finance), plus `--space-*`, `--radius-*` and the font tokens. A literal hex in a
  component is a bug: it survives a palette change and drifts. Use `color-mix(in srgb, var(--x) N%,
  transparent)` for tints.
- Fonts are the brand's: **Fraunces** (display, `--font-display`) and **Inter** (body,
  `--font-body`), loaded in `app/layout.tsx` via `next/font/google`. `--font-mono` is for
  identifiers (CPF/CNPJ, wallet addresses, session ids) - they are data to check, not prose.
  Note `next/font/google` downloads at build time, so an offline build fails.

## Gotchas the agent cannot infer

| Gotcha | Detail |
|--------|--------|
| Cash-in sells XLM and nothing else | The Stellar chain in `configs/gateway-config.json` carries XLM (`100`), USDC (`101`) and BRLP (`102`), but cash-in offers **only XLM** - `lib/partner/cashinAssets.ts`. `CashinCard` shows it as a read-only field (no selector) and `app/api/partner/cashin/quote` 400s any other `assetId`, so the rule holds against a hand-crafted request too. Widening the offer means changing that module, not the card. Cash-**out** is unaffected and still reads `accepted-cryptos` from the partner. |
| `ethereum/` folder, `'evm'` id | EVM types live at `lib/processor/ethereum/` (folder `ethereum/`, not `evm/`), though the `ChainId` is `'evm'`. |
| No client-side interpretation | The Partner API builds the tx payload; the client only signs. `lib/processor/InstructionInterpreter.ts` is now just transport types (`InterpretRequest`/`RawInstruction`/`InterpretResponse`). Two dispatch modes remain, by capability: `submitTransferInterpret` (Solana/EVM/Stellar, signs the API instruction as-is) and `submitTransfer` (TRON/XRPL, builds inline from the API's authoritative `receiver`/`memo`/`amount`). The only surviving interpreter is `lib/processor/xrpl/interpret.ts` (XRPL `Payment` assembly). |
| TON is not wired | `lib/processor/toncoin/interpret.ts` exists but TON is absent from `CHAIN_ORDER`/`ChainId`. Treat it as unwired. |
| Binance wagmi target | `lib/chains/evm/binance.ts` uses the object-form `target` with a `provider` function; the string `injected({ target: 'binance' })` does not exist in the installed `@wagmi/core`. |
| Intentional hydration flag | `suppressHydrationWarning` on `<html>` (`app/layout.tsx`) is intentional (Stellar Wallets Kit injects `--swk-*` vars). Do not remove it. |
| `.grid` is THREE columns | `.grid` (`globals.css`) is `repeat(3, 1fr)` above 768px. Using it for a row of two fields leaves an orphan column and reads as broken alignment - this was a real bug in the KYC forms. For field pairs use **`.f-pair`** (2 columns). `.grid` is for genuine 3-up layouts. |
| **CNPJ is alphanumeric** | Since IN RFB nº 2.229/2024 (rolling out from July 2026) the first 12 chars of a CNPJ can be **letters**; only the 2 check digits stay numeric. **Never `replace(/\D/g,'')` a CNPJ** - it silently deletes the letters and mutilates the document. Use `onlyCnpjChars` (`lib/partner/kycValidation.ts`); `onlyDigits` is for CPF/CEP only. The DV is module 11 with each char valued `ASCII - 48` ('A'=17…'Z'=42), which is why old numeric CNPJs still validate identically. Real vector in the tests: `00.000.000/E08G-12`, the first one issued in Brazil. |
| QSA CPF is masked | The CNPJ lookup returns the ownership structure (`owners`) with the partner's CPF **masked by Receita Federal** (`***345856**`) - the full number is not public. `ownersFromQsa` (`lib/partner/kycAutofill.ts`) deliberately leaves the CPF field empty and exposes the partial value as a hint only; filling it would fail the form's own checksum validation. Also: `owners` is present only when the free upstream provider answered, absent on the paid fallback. |
| KYB submit is dead upstream | `/sessions/legal-person` always 503s (no active PJ provider) - BUG-H18. The PJ tab warns up front, but the CNPJ lookup on it works and is useful. |

## Documentation

Point to `docs/` instead of restating it here.

| Doc | Topic |
|-----|-------|
| `docs/00-overview-and-architecture.md` | Stack, WalletSlice, registry, layering, providers, commands, env. Start here. |
| `docs/01-chains-and-wallets.md` | Registry, per-chain `useSlice`, actions, Binance, exclusivity guard, wallet catalog |
| `docs/02-actions-and-interpreter.md` | Partner-API-built instruction (`useCashout`), the two transfer dispatch modes |
| `docs/03-server-api-and-security.md` | `app/api/*`, CORS, rate-limit, session token, `server-only` |
| `docs/04-partner-api.md` | Partner API: HMAC, user-JWT, cash-in/out, KYC-KYB |
| `docs/05-ledger-and-hardware.md` | Ledger connector factory (DMK WebHID vs Live App) |
| `docs/06-environment-variables.md` | Full env reference: every var, required-or-not, defaults, "minimum to run in production" checklist |
| `docs/adding-a-chain.md` | Playbook for a new chain |
| `docs/known-issues.md` | Audited pre-existing bugs and hardening gaps; read before touching a subsystem |

Docs upkeep (mandatory): update the matching `docs/` block in the same change that touches a route,
slice, action, helper, or convention. Any new convention must also be reflected in this file.
Out-of-date docs are a bug.
