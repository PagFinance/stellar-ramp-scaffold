// lib/partner/partnerClient.ts
//
// Cliente server-only de alto nível para a PagFinance Partner API.
// Encapsula: assinatura HMAC, emissão/cache de JWT do usuário, e o mapeamento
// dos endpoints de cash-in / cash-out / preço / accepted-cryptos / validate.
//
// Regras:
//  - Endpoints públicos (quote, price, accepted-cryptos, validate) → fetch simples
//    (quote leva os headers x-app-*). Sem HMAC.
//  - auth/token → HMAC (machine-to-machine do parceiro).
//  - intent / charge / status → JWT Bearer do usuário (mintado via auth/token).
//
// ⚠️ server-only: usa o rawSecret do parceiro.
import 'server-only'

import { getPartnerConfig } from '@/lib/env'
import { signedFetch } from '@/lib/partner/hmacSigner'
import { getCachedJwt, setCachedJwt } from '@/lib/partner/jwtCache'
import {
  PARTNER_NOT_CONFIGURED,
  type PartnerEnvelope,
  type PartnerMessageEnvelope,
  type CashoutQuoteRequest,
  type CashoutQuoteResponse,
  type CashoutIntentResponse,
  type CashoutIntentStatus,
  type CashinQuoteRequest,
  type CashinQuoteResponse,
  type CashinIntentRequest,
  type CashinIntentResponse,
  type CashinIntentStatus,
  type AssetPrice,
  type AcceptedCryptos,
  type ValidateCodeRequest,
  type ValidatedTransfer,
  type KycNaturalPersonRequest,
  type KycLegalPersonRequest,
  type KycSession,
  type DocumentLookupRequest,
  type DocumentLookupData,
} from '@/lib/partner/types'

// ── Erros tipados ────────────────────────────────────────────────────────────

/** Lançado quando falta config (baseUrl/partnerId/rawSecret). Rota → 503. */
export class PartnerNotConfiguredError extends Error {
  code = PARTNER_NOT_CONFIGURED
  constructor() {
    super('Partner API não configurada.')
    this.name = 'PartnerNotConfiguredError'
  }
}

/** Erro upstream com status HTTP para propagar à rota. */
export class PartnerApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public payload?: unknown,
  ) {
    super(message)
    this.name = 'PartnerApiError'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertConfigured() {
  const cfg = getPartnerConfig()
  if (!cfg.configured) throw new PartnerNotConfiguredError()
  return cfg
}

/** Converte um TTL "7d"/"12h"/"30m"/"3600s" em segundos. */
function parseExpiryToSeconds(expiresIn: string | number | undefined): number | undefined {
  if (expiresIn == null) return undefined
  if (typeof expiresIn === 'number') return expiresIn
  const m = expiresIn.match(/^(\d+)([smhd])$/)
  if (!m) return undefined
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return parseInt(m[1]!, 10) * (units[m[2]!] ?? 1)
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new PartnerApiError(res.status, `Resposta inválida da API (${res.status}).`)
  }
  // Envelope padrão { success, error, data } ou { success, message, data }.
  if (!res.ok || json?.success === false) {
    const message = json?.error ?? json?.message ?? `Erro upstream (${res.status}).`
    throw new PartnerApiError(res.status, message, json?.code, json)
  }
  return (json?.data ?? json) as T
}

// ── Auth: mint/cache do JWT do usuário ───────────────────────────────────────

interface Cfg {
  baseUrl: string
  partnerId: string
  rawSecret: string
  jwtTtlSeconds?: number
}

/** Emite (sem cache) o JWT do usuário via HMAC `POST /auth/token`. */
async function requestUserJwt(
  cfg: Cfg,
  pubkey: string,
): Promise<{ token: string; expiresIn?: string | number }> {
  const body: Record<string, unknown> = { pubkey }
  if (cfg.jwtTtlSeconds) body.expiresIn = `${cfg.jwtTtlSeconds}s`

  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/auth/token',
    body,
  })
  return parseEnvelope<{ token: string; expiresIn?: string | number }>(res)
}

/**
 * Provisiona a carteira como usuário do parceiro (HMAC `POST /users`).
 *
 * O backend exige que o usuário exista ANTES de emitir o JWT - `POST /auth/token`
 * responde `404 USER_NOT_FOUND` caso contrário. Neste scaffold o "parceiro" é o
 * próprio servidor, e a posse da carteira já foi comprovada pela sessão
 * (`lib/server/partnerSession.ts`), então cadastramos sob demanda. O cadastro é
 * idempotente pelo `externalUserId` (usamos a própria pubkey), e nasce PENDING -
 * o gate de KYC continua valendo nas rotas de dinheiro, então isto NÃO libera
 * operação sem KYC, apenas destrava a emissão do token de identidade.
 */
async function registerWalletUser(cfg: Cfg, pubkey: string): Promise<void> {
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/users',
    body: { pubkey, externalUserId: pubkey },
  })
  // Sucesso (201) devolve o registro (ignorado); erro upstream vira PartnerApiError.
  await parseEnvelope<unknown>(res)
}

async function mintUserJwt(pubkey: string): Promise<string> {
  const cfg = assertConfigured()

  const cached = getCachedJwt(pubkey)
  if (cached) return cached

  let data: { token: string; expiresIn?: string | number }
  try {
    data = await requestUserJwt(cfg, pubkey)
  } catch (err) {
    // Carteira ainda não provisionada neste parceiro: cadastra sob demanda
    // (idempotente) e tenta emitir o token uma única vez a mais.
    if (err instanceof PartnerApiError && err.code === 'USER_NOT_FOUND') {
      await registerWalletUser(cfg, pubkey)
      data = await requestUserJwt(cfg, pubkey)
    } else {
      throw err
    }
  }

  const ttl = cfg.jwtTtlSeconds ?? parseExpiryToSeconds(data.expiresIn)
  setCachedJwt(pubkey, data.token, ttl)
  return data.token
}

/** Header Authorization Bearer para chamadas JWT-authed. */
async function bearer(pubkey: string): Promise<Record<string, string>> {
  const token = await mintUserJwt(pubkey)
  return { Authorization: `Bearer ${token}` }
}

// ── Cash-out ──────────────────────────────────────────────────────────────────

export async function cashoutQuote(
  pubkey: string,
  body: CashoutQuoteRequest,
): Promise<CashoutQuoteResponse> {
  const cfg = assertConfigured()
  // JWT do usuário (sender) + headers x-app-*. A rota exige [authenticate,
  // requireKyc] - o pubkey precisa estar provisionado e com KYC aprovado.
  const res = await fetch(`${cfg.baseUrl}/api/v1/cashout/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cfg.appHeaders,
      ...(await bearer(pubkey)),
    },
    body: JSON.stringify(body),
  })
  return parseEnvelope<CashoutQuoteResponse>(res)
}

export async function cashoutIntent(
  pubkey: string,
  body: { quoteId: string; sender: string; webhookUrl?: string },
  idempotencyKey?: string,
): Promise<CashoutIntentResponse> {
  const cfg = assertConfigured()
  const headers = {
    ...(await bearer(pubkey)),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/cashout/intent',
    body,
    extraHeaders: headers,
  })
  return parseEnvelope<CashoutIntentResponse>(res)
}

export async function cashoutIntentStatus(
  pubkey: string,
  intentId: string,
): Promise<CashoutIntentStatus> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'GET',
    path: `/api/v1/cashout/intent/${encodeURIComponent(intentId)}`,
    extraHeaders: await bearer(pubkey),
  })
  return parseEnvelope<CashoutIntentStatus>(res)
}

// ── Cash-in (onramp) ────────────────────────────────────────────────────────
// Fluxo canônico: quote → intent → status. Todos JWT Bearer do usuário (quote e
// intent exigem KYC aprovado no lado do parceiro). `signedFetch` omite o HMAC
// quando o header Authorization Bearer já está presente.

/** Cotação fiat → cripto (`POST /api/v1/cashin/quote`). Devolve `quoteId`. */
export async function cashinQuote(
  pubkey: string,
  body: CashinQuoteRequest,
): Promise<CashinQuoteResponse> {
  const cfg = assertConfigured()
  // Igual ao cashout/quote: além do JWT Bearer, o endpoint de cotação exige os
  // headers x-app-* (contexto do app). Sem eles o middleware upstream quebra (500).
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/cashin/quote',
    body,
    extraHeaders: { ...cfg.appHeaders, ...(await bearer(pubkey)) },
  })
  return parseEnvelope<CashinQuoteResponse>(res)
}

/** Cria a cobrança Pix (`POST /api/v1/cashin/intent`, idempotente). */
export async function cashinIntent(
  pubkey: string,
  body: CashinIntentRequest,
  idempotencyKey?: string,
): Promise<CashinIntentResponse> {
  const cfg = assertConfigured()
  const headers = {
    ...(await bearer(pubkey)),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/cashin/intent',
    body,
    extraHeaders: headers,
  })
  return parseEnvelope<CashinIntentResponse>(res)
}

/** Status da cobrança (`GET /api/v1/cashin/intent/:intentId`). */
export async function cashinIntentStatus(
  pubkey: string,
  intentId: string,
): Promise<CashinIntentStatus> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'GET',
    path: `/api/v1/cashin/intent/${encodeURIComponent(intentId)}`,
    extraHeaders: await bearer(pubkey),
  })
  return parseEnvelope<CashinIntentStatus>(res)
}

// ── Público: preço / accepted-cryptos / validate ──────────────────────────────

export async function assetPrice(
  assetId: number | string,
  fiatCurrency = 'BRL',
): Promise<AssetPrice> {
  const cfg = assertConfigured()
  const qs = new URLSearchParams({ assetId: String(assetId), fiatCurrency })
  const res = await fetch(`${cfg.baseUrl}/api/v1/getAssetPrice?${qs.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  return parseEnvelope<AssetPrice>(res)
}

export async function acceptedCryptos(chain: string): Promise<AcceptedCryptos> {
  const cfg = assertConfigured()
  const qs = new URLSearchParams({ chain })
  const res = await fetch(`${cfg.baseUrl}/api/v1/accepted-cryptos?${qs.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  return parseEnvelope<AcceptedCryptos>(res)
}

export async function validateCode(body: ValidateCodeRequest): Promise<ValidatedTransfer> {
  const cfg = assertConfigured()
  const res = await fetch(`${cfg.baseUrl}/api/v1/validate-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // validate-code usa envelope { success, message, data }.
  const text = await res.text()
  let json: PartnerMessageEnvelope<ValidatedTransfer> | any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new PartnerApiError(res.status, `Resposta inválida da API (${res.status}).`)
  }
  if (!res.ok || json?.success === false) {
    throw new PartnerApiError(
      res.status,
      json?.message ?? json?.error ?? `Erro upstream (${res.status}).`,
      undefined,
      json,
    )
  }
  return (json?.data ?? {}) as ValidatedTransfer
}

// ── KYC / KYB (onboarding PF / PJ) - HMAC ─────────────────────────────────────
// Endpoints machine-to-machine do parceiro (/api/v1/users/kyc/*). Sem JWT de
// usuário: a sessão é do parceiro, identificada por externalUserId no body.

export async function kycNaturalPerson(body: KycNaturalPersonRequest): Promise<KycSession> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/users/kyc/sessions/natural-person',
    body,
  })
  return parseEnvelope<KycSession>(res)
}

export async function kycLegalPerson(body: KycLegalPersonRequest): Promise<KycSession> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/users/kyc/sessions/legal-person',
    body,
  })
  return parseEnvelope<KycSession>(res)
}

export async function kycSessionStatus(sessionId: string): Promise<KycSession> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'GET',
    path: `/api/v1/users/kyc/sessions/${encodeURIComponent(sessionId)}`,
  })
  return parseEnvelope<KycSession>(res)
}

/**
 * Consulta cadastral de CPF/CNPJ (`POST /api/v1/users/kyc/lookup`).
 *
 * Não abre sessão nem persiste nada: alimenta o preenchimento automático dos
 * formulários. O parceiro resolve por uma cadeia de providers e responde `404`
 * quando o documento não existe - o `handleError` da rota preserva esse status.
 */
export async function kycLookup(body: DocumentLookupRequest): Promise<DocumentLookupData> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: '/api/v1/users/kyc/lookup',
    body: { country: 'BR', ...body },
  })
  return parseEnvelope<DocumentLookupData>(res)
}

export async function kycSyncSession(sessionId: string): Promise<KycSession> {
  const cfg = assertConfigured()
  const res = await signedFetch({
    baseUrl: cfg.baseUrl,
    partnerId: cfg.partnerId,
    rawSecret: cfg.rawSecret,
    method: 'POST',
    path: `/api/v1/users/kyc/sessions/${encodeURIComponent(sessionId)}/sync`,
  })
  return parseEnvelope<KycSession>(res)
}

// Re-export do envelope para as rotas.
export type { PartnerEnvelope }
