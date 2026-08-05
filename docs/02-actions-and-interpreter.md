# 02 - Transfer instruction & dispatch

How a signed transaction is produced. **The transaction payload is built by the Partner API, not by
the client** - the scaffold only signs and sends.

## Where the instruction comes from

There is no client-side interpretation. The authoritative flow is `hooks/useCashout.ts`
(cripto → Pix):

1. `getQuote` → `confirm` calls the Partner API cash-out **intent** endpoint.
2. The intent response carries the authoritative `receiver`, `memo`, `amount`, and `blockchain`.
3. `useCashout` wraps that into an `InterpretResponse` **without touching the values** and hands it
   to the active wallet's slice.

The receiver wallet is the Partner API's responsibility - the client never resolves it from env.
(Cash-in, Pix → cripto, does not build any on-chain tx: the partner infers the wallet from the
minted JWT.)

## The dispatch modes

The wallet slice exposes one of two capabilities; `useCashout` picks by capability, not by a chain
switch. Both remain in the `WalletSlice` contract, but **only the response-based path (Stellar) is
wired** in this scaffold:

- **Response-based (`submitTransferInterpret(response)`)** - **Stellar**. The wallet consumes a ready
  `InterpretResponse` and signs/builds from `response.result`.
- **Req-based (`submitTransfer(req)`)** - kept in the contract/type-guards for portability, but no
  registered chain uses it here.

## The Stellar path

Stellar's intent does **not** carry a serialized transaction. Instead, the intent's `instruction`
holds the authoritative `receiver`, `amount`, and `memo`:

- The memo is `MEMO_TEXT` (the canonical `paycrypto:<cid>` when it fits in 28 bytes) or `MEMO_HASH`
  (the CID hashed, when it exceeds 28 bytes - the partner stores the `memo → cid` mapping so its
  validation Lambda can resolve it). `useCashout` forwards it as `result.memo` / `result.memoType`.
- `stellarSubmitInterpret` (`lib/actions/stellar-actions.ts`) reads those fields, builds the
  `Operation.payment` locally, attaches the memo, signs the XDR through the wallet, and submits to
  Horizon.
- **The memo is the order-reconciliation key.** If a Stellar intent comes back **without** a memo,
  `useCashout` aborts **before signing** - a memo-less payment settles on-chain but never matches the
  order (`hooks/useCashout.ts`).

Backend readiness for Stellar requires a configured Stellar receiver on the partner side and at least
one Stellar asset in the gateway config (`configs/gateway-config.json` ships XLM / USDC / BRLP).

## `lib/processor/InstructionInterpreter.ts`

Just the transport types shared with the Partner API response - no interpretation logic:

- `InterpretRequest = { sender, receiver, metadata, amount, asset }` - `metadata` is the payment
  memo (`"paycrypto:…"` / `"buycrypto:…"`).
- `RawInstruction = { blockchain, instruction, memo?, memoType?, receiver?, amount?, … }` - for
  Stellar it carries the memo fields (`memo` / `memoType`) and `receiver` / `amount` instead of a
  serialized instruction.
- `InterpretResponse = { request, result }` - what `submitTransferInterpret` consumes.

## Memo validation

The client no longer decides `MEMO_TEXT` vs `MEMO_HASH` - the Partner API does. Before signing, the
client still **validates** whatever the API sent: `validateMemo` (`lib/chains/stellar/stellarHelpers.ts`)
measures `MEMO_TEXT` in **bytes** (`Buffer.byteLength`, max 28) and requires `MEMO_HASH` to be a
32-byte hex value; `buildMemo` (`lib/actions/stellar-actions.ts`) hex-decodes `MEMO_HASH`. A memo that
fails validation throws before the wallet is asked to sign.
