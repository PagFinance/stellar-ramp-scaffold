# 04 - PagFinance Partner API (cash-in / cash-out / KYC-KYB)

The scaffold integrates the **PagFinance Partner API** (`https://sandbox.brlp.io` in the example
env) for fiat on/off-ramp and identity onboarding. All of it is **server-only**: the browser calls
`app/api/partner/*`, which call the server-only client `lib/partner/partnerClient.ts`, which signs
and forwards to the partner. The HMAC secret and user JWTs never reach the client.

```
components/actions/CashinCard, CashoutCard   components/partner/kyc/*
        |  fetch (browser)
lib/partner/browserClient.ts
        |  →
app/api/partner/*  (route handlers, server)   ← lib/partner/routeHelpers.ts (error → status)
        |  →
lib/partner/partnerClient.ts (server-only: HMAC + user-JWT)
        |  → partner upstream (PARTNER_API_BASE_URL)
```

## Configuration & the 503 gate

`lib/env.ts#getPartnerConfig()` derives config from validated env. `configured === true` only when
`PARTNER_API_BASE_URL` **and** `PARTNER_ID` **and** `PARTNER_RAW_SECRET` are all set. When not
configured, `partnerClient` throws `PartnerNotConfiguredError` and the routes respond **503 "Partner
API não configurada"**. **There is no mock mode** - the integration is real-only.

| Var | Use |
|-----|-----|
| `PARTNER_API_BASE_URL` | Partner base URL (trailing slash stripped) |
| `PARTNER_ID` / `PARTNER_RAW_SECRET` | HMAC identity + secret (delivered on partner provisioning) |
| `PARTNER_APP_NAME` / `_VERSION` / `_DOMAIN` | `x-app-*` headers required by `POST /cashout/quote` |
| `PARTNER_JWT_TTL_SECONDS` | Optional TTL for the per-user JWT (partner default 7d) |

## Auth layers (three of them)

`partnerClient` uses a different auth per endpoint class:
1. **Public** (`getAssetPrice`, `accepted-cryptos`, `validate-code`) - plain `fetch`. No HMAC,
   no JWT.
2. **HMAC (machine-to-machine)** - `auth/token` (JWT mint), `users` (just-in-time wallet
   provisioning), and the KYC endpoints. Signed via
   `signedFetch` (see [`03`](03-server-api-and-security.md#partner-hmac-signing--libpartnerhmacsignerts)).
3. **User JWT Bearer** - `cashout/quote`, `cashout/intent`, `cashin/quote`, `cashin/intent`, and
   their status reads. The JWT is minted per wallet pubkey via `auth/token` and cached
   (`lib/partner/jwtCache.ts`). Both quote endpoints (`cashout/quote` and `cashin/quote`)
   additionally send the `x-app-*` headers - the upstream quote middleware requires the app
   context and returns 500 when it is absent.

> ⚠️ **`cashout/quote` is NOT public.** The upstream route is guarded by `[authenticate, requireKyc]`
> (user JWT + approved KYC), exactly like `cashout/intent` and the cash-in endpoints. Older
> docs/OpenAPI that call it "public" are stale - `cashoutQuote(pubkey, body)` mints the Bearer from
> `sender`.

`mintUserJwt(pubkey)` mints-and-caches; on `404 USER_NOT_FOUND` it provisions the wallet via
`registerWalletUser` and retries once (see *Gotchas*). `bearer(pubkey)` builds the
`Authorization: Bearer` header.

> ⚠️ **Scaffold limitation:** `jwtCache.ts` is in-memory (per instance) - swap for Redis/KV in
> multi-instance production.

## Flows & routes

Envelopes are unwrapped by `parseEnvelope` (`{ success, error|message, data }` → `data`); upstream
errors become a typed `PartnerApiError` carrying the HTTP status, which `routeHelpers.ts` maps back
to a response status.

**Cash-out** (crypto → fiat):
- `POST /api/partner/cashout/quote` → `cashoutQuote(pubkey, …)` (user JWT Bearer + `x-app-*`; the
  `sender` in the body is the pubkey the JWT is minted for)
- `POST /api/partner/cashout/intent` → `cashoutIntent(pubkey, …)` (Bearer only - `signedFetch`
  omits the HMAC header when a user JWT is present; optional `Idempotency-Key`)
- `GET /api/partner/cashout/intent/[intentId]` → `cashoutIntentStatus` - polled until
  `COMPLETED`/`FAILED`/`EXPIRED`. `useCashout.pollStatus` uses **adaptive backoff** (≈5s → 10s → 15s
  cap, with jitter), **not** a fixed interval: the whole upstream `/cashout` scope is capped at
  **10 req/min per pubkey** (shared with `quote`+`intent`), so the old fixed 4s poll (15/min) tripped
  a `429`. A `429` from the status read triggers a longer cool-down (it does not abort the flow); the
  crypto is already sent, so a poll timeout resolves to `completed` and settlement continues server-side.

This scaffold is **Stellar-only**: the intent returns a Payment *descriptor* (receiver, asset,
amount, and the authoritative `memo` with its `type`) that the wallet assembles and signs locally.
`useCashout` gates on `SUPPORTED_CHAINS = { stellar }`. Stellar readiness requires a configured
Stellar receiver on the partner side and a Stellar asset in the gateway config.

**Cash-in / onramp** (fiat → crypto) - canonical `quote → intent → status` flow (all Bearer; the
partner's deprecated `/cashin/charge*` aliases are **not** used):
- `POST /api/partner/cashin/quote` → `cashinQuote(pubkey, …)` (user JWT Bearer + `x-app-*`, same as
  `cashout/quote`) - fiat→crypto estimate; returns a single-use `quoteId` (short TTL) plus
  `valuesAndFees` / `priceContext`. This is the step that makes it an onramp: it surfaces how much
  crypto the user receives and at what rate.

  > **What the user buys - XLM only.** This scaffold's cash-in offers exactly one asset: **XLM on
  > Stellar**, `assetId 100`, read from the local `configs/gateway-config.json` via
  > `lib/partner/cashinAssets.ts#getCashinAsset`. The Stellar chain in that config also carries USDC
  > (`101`) and BRLP (`102`) - both are deliberately **out** of the cash-in offer, not merely hidden.
  > There is no selector because there is no choice: `CashinCard` renders network and asset as
  > read-only fields and `useCashin` sends `assetId: 100` on the quote. The restriction is enforced
  > on both sides - `app/api/partner/cashin/quote` rejects any other `assetId` with a 400
  > (`isAllowedCashinAssetId`), so it survives a hand-crafted request, not just the UI. A missing
  > `assetId` is still accepted (legacy value-only quote), which is also what happens if XLM's
  > `status` is flipped to `false` in the config. `tests/cashinAssets.test.ts` pins the id.
  >
  > **Delivery model - legacy (Stellar).** The partner does **not** validate `destinationWallet` for
  > Stellar (`cashin.service.ts` `isValidDestinationForChain` accepts only EVM `0x…` / Solana base58;
  > Stellar resolves to `false`), so an on-chain `destinationWallet` would **400** the quote.
  > `useCashin` therefore **omits `destinationWallet`** and takes the **legacy path**
  > (`feature:'cashin'`): a paid Pix emits `CASHIN_COMPLETED` **without** `deliveryId` and an operator
  > backend credits the crypto out-of-band. (`RequestQuoteInput` still accepts an optional
  > `destinationWallet`, but the Stellar `CashinCard` never sets it.)
- `POST /api/partner/cashin/intent` → `cashinIntent(pubkey, …)` - creates the Pix charge
  (`brCode`/`qrCodeImage`), bound to `quoteId` so the price is locked (Bearer only - HMAC omitted when
  the user JWT is present; `Idempotency-Key` keyed on the `quoteId`). `intentId === correlationID`.
  The whole `customer` block is **optional** - `name`, `taxID` (CPF/CNPJ), `email` and `phone` alike.
  The route trims each field, drops the empty ones and omits `customer` from the upstream body when
  nothing is left; the QR is generated either way (the partner-api only attaches a Woovi customer
  when name and taxID are both present, so a partial block changes nothing). `CashinCard` therefore
  blocks nothing on the payer form - `Gerar cobrança Pix` works with every field empty.
- `GET /api/partner/cashin/intent/[intentId]` → `cashinIntentStatus` - polled until
  `COMPLETED`/`EXPIRED`.

Settlement/expiry is driven by the partner's inbound Woovi webhook, which emits the outbound
`CASHIN_COMPLETED` event; the scaffold only polls the intent status. `webhookUrl` on the intent is
optional (and deprecated upstream in favor of a partner-level webhook config).

**Public data:** `GET /api/partner/price` (`assetPrice`), `GET /api/partner/accepted-cryptos`
(`acceptedCryptos`), `POST /api/partner/validate-code` (`validateCode` - uses the `{ success,
message, data }` envelope).

**KYC / KYB onboarding** (HMAC to the partner; the scaffold binds identity to a wallet session):
- `POST /api/partner/kyc/lookup` → `kycLookup` (consulta cadastral CPF/CNPJ, ver abaixo)
- `POST /api/partner/kyc/natural-person` → `kycNaturalPerson` (PF) - `components/partner/kyc/*`
- `POST /api/partner/kyc/legal-person` → `kycLegalPerson` (PJ / KYB)
- `GET /api/partner/kyc/sessions/[sessionId]` → `kycSessionStatus`
- `POST /api/partner/kyc/sessions/[sessionId]/sync` → `kycSyncSession`

### Document lookup - autofill dos formulários

`POST /api/partner/kyc/lookup` → upstream `POST /api/v1/users/kyc/lookup`. Body
`{ documentType: 'CPF' | 'CNPJ', documentNumber, country? }` (default `BR`). Consulta cadastral
pura: não abre sessão e não persiste nada.

Upstream a consulta é resolvida por uma **cadeia de providers**: para CNPJ, OpenCNPJ (gratuito, base
pública da Receita Federal) e, se ele estiver fora, BigDataCorp (pago). Para CPF só há BigDataCorp.
Resultado cacheado no Redis do parceiro. Consequência prática para este scaffold: **o bloco `owners`
(QSA) só existe quando o provider gratuito respondeu** - no fallback pago ele vem ausente. Trate-o
como best-effort, nunca como campo garantido.

A rota **exige a sessão de carteira** (`requireSession`), igual às rotas de status/sync. Sem isso
seria uma consulta anônima de CPF rodando na conta do parceiro, com um provider pago no fim da
cadeia. Também valida o checksum de CPF/CNPJ antes de gastar a chamada upstream.

O mapeamento consulta → formulário vive em **`lib/partner/kycAutofill.ts`** (funções puras, testadas
em `tests/kycAutofill.test.ts`); o hook é `hooks/useKycLookup.ts`, no mesmo formato imperativo do
`useKyc`. O que cada consulta preenche:

| Documento | Preenche | Também exibe |
|---|---|---|
| **CPF** | `fullName`, `birthDate`, `motherName` | bloqueia o envio em óbito ou situação != `REGULAR` |
| **CNPJ** | razão social, nome fantasia, e-mail, telefone, endereço completo, tipo de empresa | bloqueia o envio se a empresa não estiver `ATIVA` |

Três armadilhas que o mapeamento resolve e que não dá para inferir do contrato:

- **O CPF do QSA vem MASCARADO** (`***345856**`) - o número completo não é público. `ownersFromQsa`
  importa nome e papel de cada sócio e deixa o campo de CPF **vazio**, expondo o valor parcial
  apenas como dica na UI. Preencher o mascarado reprovaria na validação de checksum do próprio
  formulário.
- **Sócio pessoa jurídica é descartado**: o formulário de sócio pede CPF, data de nascimento e nome
  da mãe, que não existem para uma empresa sócia.
- **`shareCapitalCents` é inteiro em centavos**, não reais.

Campo ausente na consulta nunca vira string vazia sobrescrevendo o que o usuário digitou: o `patch`
só carrega o que a fonte informou de fato.

### Máscaras e o CNPJ alfanumérico

`lib/partner/documentMask.ts` traz máscaras progressivas e idempotentes (aplicadas a cada tecla) para
**CPF** (`000.000.000-00`), **CNPJ** (`AA.AAA.AAA/AAAA-00`) e **CEP** (`00000-000`). Ligadas via a
prop `mask` de `TextField` / `DocumentLookupField`. **Telefone não tem máscara de propósito**: o
formulário submete `phoneNumber`/`contactNumber` crus, então formatar na tela mandaria
`+55 (61) 3493-9002` para a Partner API. CPF, CNPJ e CEP podem ser mascarados porque são
sanitizados antes do submit.

### A página `/kyc`

`app/kyc/page.tsx` monta um **console** da Partner API, não uma landing: cabeçalho com selo de
ambiente, alternância PF/PJ, formulário à esquerda e um trilho fixo à direita com a carteira ativa e
o estado da sessão (`KycSessionResult`).

O formulário é dividido em seções numeradas (`FormSection`, em `components/partner/kyc/fields.tsx`).
A numeração **não é decoração**: reflete a ordem que a própria API exige (identificação -> dados ->
sócios -> envio).

No KYB, o quadro societário é uma lista **colapsável**, com um sócio aberto por vez. Com 5 sócios
vindos do QSA, o layout anterior exibia cerca de 40 campos simultâneos; o cabeçalho de cada bloco
mostra nome e papel, que é o suficiente para localizar quem falta preencher.

Classes em `globals.css`, seção *KYC / KYB console*: `.kyc-wrap`, `.kyc-head`, `.kyc-seg`,
`.kyc-cols`, `.sec`, `.f-pair`, `.doc-field`, `.owner`, `.rail`, `.notice`. A página vive dentro de
`main.container` (960px), então `.kyc-wrap` só controla o respiro vertical - não redefine largura.

> ⚠️ **CNPJ é ALFANUMÉRICO** (IN RFB nº 2.229/2024, em vigor progressivo desde julho/2026). Os 12
> primeiros caracteres podem conter letras; só os 2 dígitos verificadores continuam numéricos.
> **Nunca aplique `replace(/\D/g,'')` a um CNPJ** - isso apaga as letras em silêncio e envia um
> documento mutilado. Use `onlyCnpjChars`; `onlyDigits` serve só para CPF e CEP. O DV é módulo 11
> com o valor de cada caractere igual a `ASCII - 48` ('0'..'9' → 0..9, 'A'..'Z' → 17..42), o que
> mantém todo CNPJ numérico antigo validando exatamente como antes. Vetor real coberto em
> `tests/kycValidation.test.ts`: `00.000.000/E08G-12`, o primeiro emitido no Brasil.

> **Identity binding (secure mode, `APP_SESSION_SECRET` set).** The submit routes derive
> `externalUserId` from the **proven wallet session** (`requireKycIdentity`) and ignore any
> client-supplied value; the status/sync routes require a wallet session (`requireSession`).
> `lib/partner/kycValidation.ts` adds CPF/CNPJ/email/date format checks. `useKyc` establishes the
> session first (like `useCashin`), so KYC needs a connected wallet in secure mode. In dev (no
> secret) the routes fall back to the client `externalUserId`. Closes NEW-H2/NEW-M1 - see
> `docs/known-issues.md`. Residual: binding a specific `sessionId` to its owner needs a server-side
> `sessionId → address` store (not in the scaffold).
>
> **Client-side identity lock (both modes).** The KYC/KYB forms
> (`components/partner/kyc/KycNaturalPersonForm.tsx`, `KycLegalPersonForm.tsx`) no longer expose a
> free-text `externalUserId`: the field is **read-only and bound to the active wallet address**
> (`walletAddress` prop, fed from `useWalletWeb3().activeAddress` in `app/kyc/page.tsx`), and submit
> is blocked with no wallet connected. This is the same address used as the cash-out `sender` (and
> the pubkey the partner-api user-JWT is minted under), so the KYC session and the cash-out user
> always share one `externalUserId`. Without it, an approved KYC session could be filed under a
> different key than the wallet user, and the partner-api `requireKyc` gate (which resolves the user
> by the JWT identity) would keep returning `kycStatus: PENDING` despite an `APPROVED` session. Note
> the residual multiwallet caveat: KYC done on wallet A does not clear cash-out from wallet B - they
> are different identities by design.

UI pages: `/cashin`, `/cashout`, `/kyc`.

## Wallet session - proof-of-ownership (closes BUG-H3)

The proxy routes mint the partner user-JWT from a `sender` pubkey. To stop a caller from acting as
**any** provisioned wallet (the old IDOR - see `docs/known-issues.md` BUG-H3), the trusted `sender`
is derived from a **wallet session** instead of the request body/query.

Flow (`lib/server/partnerSession.ts`, `lib/partner/session.ts`, `hooks/useCashout.ts` +
`hooks/useCashin.ts`):

1. `GET /api/partner/session/challenge?address=&blockchain=` → `{ challengeToken, message }`
   (`challengeToken` = short-lived HS256 JWT binding a nonce + address + chain).
2. The **active wallet signs** `message` (`slice.signMessage`).
3. `POST /api/partner/session { address, blockchain, publicKey?, signature, challengeToken }` →
   the server re-derives the message, verifies the Stellar Ed25519 signature via
   `@stellar/stellar-sdk` (`verifyWalletSignature` → `lib/chains/stellar/verifySignature.ts`), and
   sets an **httpOnly session cookie** (`pf_partner_session`, HS256, `sub=address`, 1h).
4. **Every** JWT-authed cash-in/out route (`cashout/{quote,intent,status}`,
   `cashin/{quote,intent,status}`) calls `requireSender(req, clientSender)` → the trusted `sender`
   comes from the verified cookie; a mismatching client `sender` → **403**, no session → **401**.

`GET /api/partner/session` returns `{ configured, address }`; `DELETE` logs out. The session is also
cleared automatically on wallet disconnect / switch - `HeaderWithConnect` calls `endPartnerSession()`
whenever the authenticated `activeAddress` goes away or changes.

**Two modes, gated by `APP_SESSION_SECRET`:**
- **Secure (secret set):** the session is required on all JWT-authed routes; `useCashout` /
  `useCashin` establish it transparently (one signature per hour) before quoting/confirming.
- **Dev (secret unset):** `sessionConfigured()` is false, the challenge is a no-op, and the routes
  fall back to the client `sender` with a `console.warn`. Keeps the local demo working with no extra
  setup. **Do not run production without `APP_SESSION_SECRET`.**

> **Wallet-backend caveat:** proof-of-ownership needs a *verifiable message signature*. Via the
> Stellar Wallets Kit `signMessage`, **Freighter, Lobstr, xBull, Hana** return one; **Albedo** does
> **not** (`signMessage` throws *not supported*), so in secure mode its login can't be completed yet -
> tracked as a follow-up. For Stellar the address (`G...`) *is* the Ed25519 public key, so no separate
> `publicKey` is needed; the verifier accepts both the raw-UTF-8 and the SEP-53 (`ed25519` over
> `SHA-256("Stellar Signed Message:\n" + message)`) signing payloads, in base64 or hex, to stay
> compatible across wallet modules (Freighter v6+ uses SEP-53).

## Gotchas

- **Users are provisioned just-in-time.** `auth/token` returns `404 USER_NOT_FOUND` when the wallet
  pubkey does not yet exist on the partner. `mintUserJwt` handles this transparently: on that error
  it registers the wallet via HMAC `POST /users` (idempotent by `externalUserId`, which is the
  pubkey) and retries the token mint once. The record is created **PENDING**, so this only unblocks
  the identity token - the money routes still require `kycStatus === APPROVED` and return
  `403 INSUFFICIENT_KYC` until KYC is approved (`registerWalletUser` in `partnerClient.ts`).
- **KYC routes are always mounted on the partner side - there is no `FEATURE_KYC_*` flag.** A
  previous version of this doc claimed `FEATURE_KYC_ONBOARDING_ENABLED` gated them / returned 404;
  that flag does not exist. Availability is driven by **provider configuration**, and an
  unconfigured operation returns **`503`** (not 404) at call time:
  - **PF (natural-person)** works via BigDataCorp, but **`country` must be `BR`** - any other
    country → `503`.
  - **PJ / legal-person (KYB) has no active provider** (BigDataCorp declines PJ; Celcoin disabled),
    so `POST /kyc/sessions/legal-person` **always returns `503`**. The scaffold ships the full PJ
    form/route, but it cannot succeed until the partner enables a PJ provider - treat KYB as
    **not yet available** end-to-end (see `docs/known-issues.md`).
- **Cash-out submit is Stellar-only.** When the active chain isn't Stellar, `CashoutCard` renders a
  *"Rede ativa (…) não suportada no cash-out. Conecte uma carteira Stellar."* notice instead of the
  submit path (`components/actions/CashoutCard.tsx`). Stellar uses `submitTransferInterpret` and
  attaches the authoritative `memo`/`memoType` from the intent to the `Payment` it builds and signs
  locally.
- **All Partner secrets are server-only.** Never move `partnerClient` / `hmacSigner` / the raw
  secret into a `'use client'` module.
