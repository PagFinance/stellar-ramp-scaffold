// lib/partner/hmacSigner.ts
//
// Assinatura HMAC-SHA256 para chamadas machine-to-machine à PagFinance
// Partner API. Fiel à referência oficial partner-api-v1/scripts/hmac-sign-example.ts
// e ao verificador partner-api-v1/src/shared/middleware/hmacAuth.ts.
//
// ── Protocolo ────────────────────────────────────────────────────────────────
//   signingKey = SHA256(rawSecret + ":" + partnerId)                  (hex)
//   canonical  = METHOD\nPATH(sem query)\nTIMESTAMP\nNONCE\nSHA256(BODY)
//   signature  = HMAC-SHA256(signingKey, canonical)                   (hex)
//   Header:    Authorization: HMAC-SHA256 partnerId=X,timestamp=Y,nonce=Z,signature=W
//
// O body é serializado UMA vez e a mesma string é usada como corpo do fetch e
// como input do hash - o servidor hasheia os BYTES CRUS recebidos, então assinar
// exatamente o que vai no fio é o contrato correto (o servidor ainda aceita, como
// fallback transitório, o hash do body normalizado, mas não dependemos disso).
//
// ⚠️ server-only: este módulo lida com o rawSecret do parceiro e nunca pode ser
// incluído em bundle de browser.
import 'server-only'

import { createHmac, createHash, randomUUID } from 'node:crypto'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

/** signingKey = SHA256(rawSecret + ":" + partnerId) → hex. */
export function deriveSigningKey(rawSecret: string, partnerId: string): string {
  return createHash('sha256').update(`${rawSecret}:${partnerId}`).digest('hex')
}

/** Serializa o body de forma determinística (JSON compacto) ou '' quando vazio. */
export function serializeBody(body?: unknown): string {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

/**
 * Monta a canonical string. `path` deve ser SEM query string (o servidor usa
 * request.url.split('?')[0]).
 */
export function buildCanonical(
  method: string,
  path: string,
  timestamp: number,
  nonce: string,
  bodyStr: string,
): string {
  const bodyHash = createHash('sha256').update(bodyStr).digest('hex')
  return [method.toUpperCase(), path, String(timestamp), nonce, bodyHash].join('\n')
}

export interface SignOptions {
  partnerId: string
  rawSecret: string
  method: HttpMethod
  /** Caminho absoluto na API (ex.: /api/v1/auth/token), SEM query string. */
  path: string
  /** String de body já serializada (use serializeBody). '' para GET/sem body. */
  bodyStr: string
}

/** Retorna o header Authorization completo + timestamp/nonce usados. */
export function signRequest(opts: SignOptions): {
  authorization: string
  timestamp: number
  nonce: string
} {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const signingKey = deriveSigningKey(opts.rawSecret, opts.partnerId)
  const canonical = buildCanonical(opts.method, opts.path, timestamp, nonce, opts.bodyStr)
  const signature = createHmac('sha256', signingKey).update(canonical).digest('hex')

  const authorization =
    `HMAC-SHA256 partnerId=${opts.partnerId},timestamp=${timestamp},` +
    `nonce=${nonce},signature=${signature}`

  return { authorization, timestamp, nonce }
}

export interface SignedFetchOptions {
  baseUrl: string
  partnerId: string
  rawSecret: string
  method: HttpMethod
  /** Caminho na API, pode conter query string - ela é removida da assinatura. */
  path: string
  body?: unknown
  /** Headers extras (ex.: x-app-*). Se incluir Authorization, o HMAC é omitido. */
  extraHeaders?: Record<string, string>
  timeoutMs?: number
}

/**
 * fetch com assinatura HMAC automática. Se `extraHeaders.Authorization` já
 * existir (ex.: Bearer JWT), NÃO adiciona o header HMAC - o endpoint é JWT-authed.
 * A query string do path é preservada na URL mas removida do canonical.
 */
export async function signedFetch(opts: SignedFetchOptions): Promise<Response> {
  const bodyStr = serializeBody(opts.body)
  const pathNoQuery = opts.path.split('?')[0]!

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.extraHeaders ?? {}),
  }

  const hasBearer = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')
  if (!hasBearer) {
    const { authorization } = signRequest({
      partnerId: opts.partnerId,
      rawSecret: opts.rawSecret,
      method: opts.method,
      path: pathNoQuery,
      bodyStr,
    })
    headers.Authorization = authorization
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    return await fetch(`${opts.baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.method === 'GET' ? undefined : bodyStr || undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
