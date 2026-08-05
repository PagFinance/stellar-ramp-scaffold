# 00 - Overview & Architecture

Read this first. It gives the stack, the core `WalletSlice` model, the layering, the provider
tree, the project layout, and the commands. The other docs go deep on one block each.

## What this is

A **Next.js 15 (App Router) Stellar ramp scaffold** for PagFinance. It is **exclusive to the Stellar
ecosystem**: a single chain, connected through the Stellar Wallets Kit. Two concerns live in one
repo:

1. **Client - connect & sign:** the Stellar wallet normalizes to one `WalletSlice`, aggregated by
   `hooks/useWalletWeb3.ts`.
2. **Server - secret-holding proxies (`app/api/*`):** the PagFinance Partner API integration;
   secrets never reach the browser.

The `WalletSlice` abstraction is kept (rather than inlining Stellar everywhere) so the layering and
the Partner-API flow stay backend-agnostic - the client never branches on which backend produced a
signature.

## The core idea: one `WalletSlice`

`lib/types/WalletSlice.ts` defines the shape the chain implements, so the rest of the app never
branches on which backend produced a signature.

- `WalletSliceCore` - state: `chainId`, `connected`, `address`, `readyForAuth`, `busy?`, `label?`,
  `walletName?`.
- `WalletActionFns` (all optional) - `connect`, `disconnect`, `signMessage`, and the two transfer
  entry points:
  - `submitTransfer(req)` - **req-based**; the wallet interprets inline.
  - `submitTransferInterpret(response)` - **response-based**; the wallet receives an already-built
    instruction. **Stellar uses this one.**
- Type-guards (`hasSignMessage`, `hasSubmitTransfer`, `hasSubmitTransferInterpret`, `hasDisconnect`)
  let callers feature-detect a slice's capabilities. Both transfer entry points remain in the
  contract, but only `submitTransferInterpret` (Stellar) is wired.

Details of the transfer flow are in [`02-actions-and-interpreter.md`](02-actions-and-interpreter.md).

## The Chain Registry (single source of truth)

`lib/chains/registry.ts` is the canonical chain list. Everything derives from it - even with one
chain, the derivation seam is preserved so the guard and `useWalletWeb3` don't hardcode `stellar`.

- `CHAIN_ORDER: ChainId[] = ['stellar']` - canonical order; also drives which chain is "active"
  (first connected wins).
- `CHAIN_REGISTRY: Record<ChainId, ChainMeta>` - per-chain `{ id, label, icon }` for UI.
- `resolveChainId(chainName)` - normalizes a network name (`stellar` / `xlm`) to the `ChainId`.

`lib/types/ChainTypes.ts` keeps the `ChainId` **union** canonical (`type ChainId = 'stellar'`) but
derives the runtime list from `CHAIN_ORDER`. `tests/registry.test.ts` fails the build if the union
and `CHAIN_ORDER` diverge.

## Layering & dependency flow

```
components/*                     UI (React + TanStack Query). No wallet SDK calls here.
  |  uses
hooks/useWalletWeb3.ts           aggregates the Stellar slice → active chain/address/wallet
hooks/useCashout.ts              cash-out: gets the API-built instruction, signs by capability
  |  one per chain
lib/chains/stellar/useSlice.ts   hook → normalized WalletSlice (wraps the Stellar Wallets Kit)
  |  delegates real work to
lib/actions/stellar-actions.ts   actual signing/transfer (builds + signs the Payment)
  |  reads / proxies through
app/api/*                        server routes: Partner API + secrets (server-only)
```

Rules baked in:
- **Registry-derived:** the guard (`SingleConnectionGuard`) and `useWalletWeb3` derive from
  `CHAIN_ORDER`. (`ConnectModal` is *not* registry-driven - it is hand-wired for the single Stellar
  entry; see [`01`](01-chains-and-wallets.md#connect-ui--componentsconnectmodaltsx).)
- **Rules of Hooks:** `useWalletWeb3` calls the one slice hook statically (`useStellarSlice`) and
  maps it into a `Record<ChainId, ChainSlice>`.
- **Active chain** = first `CHAIN_ORDER` entry whose slice reports `connected`.

## Provider tree (`app/providers.tsx`)

Outer → inner:

```
QueryClientProvider
└ ToastProvider
  └ StellarWalletProvider          (Stellar Wallets Kit init + context; contexts/StellarWalletProvider.tsx)
    ├ SingleConnectionGuard        (guard hook; one-wallet-at-a-time seam kept for the registry)
    └ children
```

`app/layout.tsx` wraps everything in `Providers` and renders `components/HeaderWithConnect.tsx`.
`suppressHydrationWarning` on `<html>` is intentional (Stellar Wallets Kit injects `--swk-*` vars).

## Project layout

```
app/                 App Router pages (/, /cashin, /cashout, /kyc) + app/api/partner/* routes
components/          UI: ConnectModal, HeaderWithConnect, actions/*, partner/*, wallet/*, toast/*
contexts/            StellarWalletProvider (the single wallet backend)
hooks/               useWalletWeb3, useCashout, useCashin, useKyc…
lib/
  chains/            registry.ts + the stellar module (useSlice, verifySignature, config, helpers)
  actions/           stellar-actions.ts (build/sign/submit the Payment)
  processor/         InstructionInterpreter (transport types only)
  types/             WalletSlice, ChainTypes, AssetType, GatewayConfigType…
  partner/           server-only PagFinance Partner API client (HMAC, JWT) + browser client
  server/            cors, rateLimit, partnerSession (endpoint hardening)
  react/, helpers/, constants/, gatewayConfig.ts, env.ts
configs/             gateway-config.json (Stellar chain + assets)
tests/               Vitest unit tests (invariants)
docs/                this documentation set
```

## Commands & env

```bash
npm i
cp .env.example .env.local
npm run dev            # next dev - http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run lint           # next lint (lint:fix autofix)
npm run test           # vitest run (test:watch)
npm run build          # next build
```

Pre-PR / CI order: `typecheck → lint → test → build`. npm (`package-lock.json`), Node 20+.

**Environment** (`.env.example` is canonical): `NEXT_PUBLIC_*` are client-exposed; everything else
is server-only and validated with zod in `lib/env.ts` (`getServerEnv()`, memoized, throws an
aggregated error on the first call if invalid). Highlights:

| Var | Scope | Use |
|-----|-------|-----|
| `NEXT_PUBLIC_PROJECT_URL` | client | Origin allowed by the proxy CORS |
| `NEXT_PUBLIC_STELLAR_NETWORK` | client | `PUBLIC` / `TESTNET` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | client | Horizon endpoint |
| `APP_SESSION_SECRET` | server | HS256 session-token secret (min 16 chars) |
| `PARTNER_*` | server | PagFinance Partner API (see [`04`](04-partner-api.md)) |

**Full env reference** (every var, required-or-not, defaults, and the "minimum to run in
production" checklist): [`06-environment-variables.md`](06-environment-variables.md).

See the per-topic docs for the rest.
