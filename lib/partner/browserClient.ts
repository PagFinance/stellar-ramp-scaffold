// lib/partner/browserClient.ts
//
// Cliente de browser para as rotas de proxy /api/partner/*. Fala apenas com o
// próprio backend Next (nunca com a partner-api direto - o segredo é server-only).
// Tipado ao envelope { success, error, data }; lança PartnerRequestError com o
// status e a mensagem quando success !== true.

import type {
  CashoutQuoteRequest,
  CashoutQuoteResponse,
  CashoutIntentResponse,
  CashoutIntentStatus,
  CashinQuoteRequest,
  CashinQuoteResponse,
  CashinIntentRequest,
  CashinIntentResponse,
  CashinIntentStatus,
  AssetPrice,
  AcceptedCryptos,
  ValidateCodeRequest,
  ValidatedTransfer,
  KycNaturalPersonRequest,
  KycLegalPersonRequest,
  KycSession,
  DocumentLookupRequest,
  DocumentLookupData,
} from '@/lib/partner/types'

export class PartnerRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /**
     * Conteúdo estruturado do erro, quando a rota manda um. Hoje só o 422 do
     * KYB (`{ companyVerification }`), que a tela usa para mostrar QUAL check
     * reprovou em vez de só a mensagem agregada.
     */
    public data?: unknown,
  ) {
    super(message)
    this.name = 'PartnerRequestError'
  }
}

interface Envelope<T> {
  success: boolean
  error?: string | null
  message?: string | null
  code?: string
  data?: T
}

async function request<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  if (init?.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()
  let json: Envelope<T>
  try {
    json = text ? JSON.parse(text) : ({} as Envelope<T>)
  } catch {
    throw new PartnerRequestError(res.status, `Resposta inválida (${res.status}).`)
  }

  if (!res.ok || json.success === false) {
    const msg = json.error ?? json.message ?? `Erro (${res.status}).`
    throw new PartnerRequestError(res.status, msg, json.code, json.data)
  }
  return (json.data ?? ({} as T)) as T
}

// ── Cash-out ──────────────────────────────────────────────────────────────
export function postCashoutQuote(body: CashoutQuoteRequest): Promise<CashoutQuoteResponse> {
  return request('/api/partner/cashout/quote', { method: 'POST', body: JSON.stringify(body) })
}

export function postCashoutIntent(
  body: { quoteId: string; sender: string; webhookUrl?: string },
  idempotencyKey?: string,
): Promise<CashoutIntentResponse> {
  return request('/api/partner/cashout/intent', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey,
  })
}

export function getCashoutIntentStatus(
  intentId: string,
  sender: string,
): Promise<CashoutIntentStatus> {
  const qs = new URLSearchParams({ sender }).toString()
  return request(`/api/partner/cashout/intent/${encodeURIComponent(intentId)}?${qs}`)
}

// ── Cash-in (onramp) ────────────────────────────────────────────────────────
export function postCashinQuote(
  body: CashinQuoteRequest & { sender: string },
): Promise<CashinQuoteResponse> {
  return request('/api/partner/cashin/quote', { method: 'POST', body: JSON.stringify(body) })
}

export function postCashinIntent(
  body: CashinIntentRequest & { sender: string },
  idempotencyKey?: string,
): Promise<CashinIntentResponse> {
  return request('/api/partner/cashin/intent', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey,
  })
}

export function getCashinIntentStatus(
  intentId: string,
  sender: string,
): Promise<CashinIntentStatus> {
  const qs = new URLSearchParams({ sender }).toString()
  return request(`/api/partner/cashin/intent/${encodeURIComponent(intentId)}?${qs}`)
}

// ── Público ────────────────────────────────────────────────────────────────
export function getAssetPrice(assetId: number | string, fiatCurrency = 'BRL'): Promise<AssetPrice> {
  const qs = new URLSearchParams({ assetId: String(assetId), fiatCurrency }).toString()
  return request(`/api/partner/price?${qs}`)
}

export function getAcceptedCryptos(chain: string): Promise<AcceptedCryptos> {
  const qs = new URLSearchParams({ chain }).toString()
  return request(`/api/partner/accepted-cryptos?${qs}`)
}

export function postValidateCode(body: ValidateCodeRequest): Promise<ValidatedTransfer> {
  return request('/api/partner/validate-code', { method: 'POST', body: JSON.stringify(body) })
}

// ── KYC / KYB ───────────────────────────────────────────────────────────────
export function postKycNaturalPerson(body: KycNaturalPersonRequest): Promise<KycSession> {
  return request('/api/partner/kyc/natural-person', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function postKycLegalPerson(body: KycLegalPersonRequest): Promise<KycSession> {
  return request('/api/partner/kyc/legal-person', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Consulta cadastral de CPF/CNPJ. Lança PartnerRequestError com 404 se não existir. */
export function postKycLookup(body: DocumentLookupRequest): Promise<DocumentLookupData> {
  return request('/api/partner/kyc/lookup', { method: 'POST', body: JSON.stringify(body) })
}

export function getKycSession(sessionId: string): Promise<KycSession> {
  return request(`/api/partner/kyc/sessions/${encodeURIComponent(sessionId)}`)
}

export function postKycSync(sessionId: string): Promise<KycSession> {
  return request(`/api/partner/kyc/sessions/${encodeURIComponent(sessionId)}/sync`, {
    method: 'POST',
  })
}
