# 01 - Chain & Wallets (Stellar)

This scaffold is **exclusive to Stellar**: one chain, connected through the Stellar Wallets Kit. This
doc explains the registry seam, the per-chain slice, the Stellar wallet backend, connect UI, and the
exclusivity guard.

## Chain registry - `lib/chains/registry.ts`

The canonical chain list and the derivation seam. See [`00`](00-overview-and-architecture.md#the-chain-registry-single-source-of-truth)
for the invariant. Even with a single chain, consumers derive from the registry rather than
hardcoding `stellar`. Key exports:

- `CHAIN_ORDER: ChainId[]` - `['stellar']`.
- `CHAIN_REGISTRY` / `CHAIN_MODULES` - `{ id, label, icon }` metadata for UI.
- `resolveChainId(name)` - normalizes a network name (`stellar` / `xlm`) to the `ChainId`, or `null`.

## Per-chain slice - `lib/chains/stellar/useSlice.ts`

`useStellarSlice()` returns a normalized `WalletSlice`: `connected`, `connecting`, `address`,
`readyForAuth`, `connect`, `disconnect`, `signMessage`, and `submitTransferInterpret`. It wraps the
`StellarWalletProvider` context and delegates real signing/transfer work to
`lib/actions/stellar-actions.ts`.

- `connecting` mirrors the provider's handshake state, so any consumer of the unified layer gets a
  uniform "conectando…" signal.
- `readyForAuth` is `connected && address` - a connected Stellar wallet whose address (the Ed25519
  public key) is known can sign the proof message.

| Chain | Slice | Backend | Transfer mode |
|-------|-------|---------|---------------|
| Stellar | `lib/chains/stellar/useSlice.ts` | Stellar Wallets Kit | `submitTransferInterpret` |

`hooks/useWalletWeb3.ts` calls `useStellarSlice()` statically (Rules of Hooks) and maps it into
`Record<ChainId, ChainSlice>`; the active chain is the first `CHAIN_ORDER` entry that is `connected`.

## Stellar wallet backend - `contexts/StellarWalletProvider.tsx`

The provider initializes the **Stellar Wallets Kit** once and exposes a `StellarCtx`:
`{ connected, connecting, address, connect, disconnect, signTransaction, signMessage }`.

- **Modules registered:** `FreighterModule`, `LobstrModule`, `xBullModule`, `HanaModule`,
  `AlbedoModule`. The kit's own `authModal()` renders the wallet picker.
- **Network** comes from `STELLAR_PASSPHRASE` (`lib/chains/stellar/stellarConfig.ts`, derived from
  `NEXT_PUBLIC_STELLAR_NETWORK`).
- **Theme:** the kit is themed via `SwkAppTheme` (light/dark) and re-themed on connect;
  `suppressHydrationWarning` on `<html>` covers the `--swk-*` vars it injects.
- **State:** it subscribes to `KitEventType.STATE_UPDATED` / `DISCONNECT` so wallet switches and
  disconnects flow back into React state; addresses are validated with `isValidStellarAddress`.
- **Signing:** `signTransaction(xdr)` returns the signed XDR; `signMessage(message)` returns the
  signed message (used for proof-of-ownership).

> **Wallet-backend caveat (proof-of-ownership):** secure-mode login needs a *verifiable message
> signature*. **Freighter, Lobstr, xBull, Hana** return one; **Albedo**'s `signMessage` throws *not
> supported*, so its secure-mode login can't complete yet (tracked as a follow-up). The Stellar
> address (`G...`) **is** the Ed25519 public key, so no separate `publicKey` is needed. See
> [`04`](04-partner-api.md#wallet-session---proof-of-ownership-closes-bug-h3).

## Signing helpers - `lib/actions/stellar-actions.ts`

The action module builds, signs, and submits the Stellar `Payment` from the Partner-API's
authoritative fields:

- `stellarSignMessage(ctx, message)` - proof-of-ownership; wraps `ctx.signMessage`.
- `stellarBuildAndSubmitPayment(ctx, params)` - validates the destination/amount/memo, checks the
  source account exists and has enough balance (accounting for the min reserve), builds the
  `Operation.payment`, attaches the memo, signs the XDR via the wallet, and submits to Horizon. It
  **retries once** on retryable errors (`tx_bad_seq` / `tx_insufficient_fee`) with a fresh sequence
  number and a bumped fee.
- `stellarSubmitInterpret(ctx, response)` - the `submitTransferInterpret` entry point: reads
  `receiver` / `amount` / `memo` / `memoType` from the Partner-API instruction and calls
  `stellarBuildAndSubmitPayment`. The memo is `MEMO_TEXT`, or `MEMO_HASH` when the CID exceeds 28
  bytes (see [`02`](02-actions-and-interpreter.md)).
- `stellarCreateTrustline(ctx, symbol, issuer)` - `changeTrust` for an issued asset.

Support modules: `horizonClient.ts` (Horizon `Server`), `stellarConfig.ts` (network/passphrase/
Horizon URL), `stellarHelpers.ts` (address/memo validation, balance checks, account load), and
`stellarErrors.ts` (`parseStellarError` → retryable + pt-BR message).

## Proof-of-ownership verifier - `lib/chains/stellar/verifySignature.ts`

`verifyStellarSignature({ message, signature, address })` verifies the wallet signature server-side.
The address `G...` **is** the Ed25519 public key (StrKey), so the key is derived from it. Because the
ecosystem hasn't converged on one message-signing format, the verifier accepts two deterministic
payloads - the **raw UTF-8** message (most wallets, incl. Freighter) and the **SEP-53**
(`sha256("Stellar Signed Message:\n" + message)`) payload - in base64, base64url, or hex. Any valid
signature of the real key over either one proves possession.

## Connect UI - `components/{ConnectModal,WalletOptions}.tsx`

The connect surface is two pieces, mirroring `@pagfinance/wallet-connect` in ramp-scaffold:

- `components/WalletOptions.tsx` - the **buttons only**: the Stellar `WalletRow`, the error box and
  the trust note. No overlay, no portal - drop it inside any host dialog. It calls `onDone` when the
  connect/disconnect finishes **or** when it hands off to the Stellar Wallets Kit's own `authModal()`
  (which lists Freighter/Lobstr/xBull/Hana/Albedo) - the host dialog must close there or the kit's
  modal renders behind it. Mount it only while the dialog is open so the error state resets.
- `components/ConnectModal.tsx` - the **dialog only**: overlay, portal, Escape, dialog a11y (initial
  focus, focus-trap, focus restoration - but it does **not** steal focus back from the kit's modal on
  handoff) and the header. It is `WalletOptions` with `onDone={onClose}`.

`tests/walletOptions.test.tsx` pins the contract between the two (`onDone` before the kit handoff,
disconnect errors keep the dialog open, Escape / close / backdrop close it). `components/HeaderWithConnect.tsx` hosts the connect button and post-connect state
(`AccountChip`), and clears the partner session when the connected address goes away or changes.

## Exclusivity - `components/common/SingleConnectionGuard.tsx`

The one-wallet-at-a-time guard sits in the provider tree (`app/providers.tsx`) and derives from the
registry. With a single registered chain it is effectively a no-op today, but the seam is kept so the
scaffold's structure stays intact.
