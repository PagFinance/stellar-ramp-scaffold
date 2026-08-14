// lib/partner/routeHelpers.ts
//
// Utilidades compartilhadas pelas rotas app/api/partner/*: envelope de resposta,
// rate-limit + CORS, e tradução de erros do partnerClient em status HTTP.
import 'server-only'

import { NextResponse } from 'next/server'
import { corsHeaders, corsPreflightHeaders } from '@/lib/server/cors'
import { rateLimit, clientIp } from '@/lib/server/rateLimit'
import { PartnerApiError, PartnerNotConfiguredError } from '@/lib/partner/partnerClient'
import { sessionConfigured, resolveSessionAddress } from '@/lib/server/partnerSession'

export const RATE_LIMIT = 60 // req/min por IP para as rotas de pagamento
export const RATE_WINDOW_MS = 60_000

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsPreflightHeaders() })
}

/** Aplica rate-limit por IP. Retorna a resposta 429 pronta, ou null se ok. */
export function enforceRateLimit(req: Request, bucket: string): NextResponse | null {
  const rl = rateLimit(`partner:${bucket}:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (rl.ok) return null
  return NextResponse.json(
    { success: false, error: 'Muitas requisições. Tente novamente em instantes.' },
    { status: 429, headers: corsHeaders() },
  )
}

/** Resposta de sucesso com o envelope padrão e CORS. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, error: null, data },
    { status, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } },
  )
}

/**
 * Resposta de erro com o envelope padrão e CORS.
 *
 * `data` é opcional e serve para o erro que CARREGA conteúdo estruturado - hoje
 * só o 422 do KYB, que devolve os checks da empresa para a tela poder dizer o
 * que exatamente reprovou. Nunca repasse o payload upstream inteiro aqui: só o
 * bloco que a UI precisa, escolhido explicitamente pela rota.
 */
export function fail(status: number, error: string, code?: string, data?: unknown): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(code ? { code } : {}),
      ...(data !== undefined ? { data } : {}),
    },
    { status, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } },
  )
}

/**
 * Resolve o `sender` (pubkey) CONFIÁVEL para uma rota JWT-authed.
 *
 * Modo seguro (APP_SESSION_SECRET definido): exige o cookie de sessão de
 * carteira e retorna o address provado nele - ignorando qualquer `sender` do
 * body/query. Se não houver sessão → 401; se o cliente mandar um sender
 * divergente → 403. Isto fecha o BUG-H3 (sender spoofável / IDOR).
 *
 * Modo dev (sem o segredo): mantém o comportamento legado - confia no sender do
 * cliente, com aviso - para não travar o demo local.
 *
 * Retorna `{ sender }` OU uma NextResponse de erro já pronta.
 */
export async function requireSender(
  req: Request,
  clientSender: string,
): Promise<{ sender: string } | NextResponse> {
  if (!sessionConfigured()) {
    console.warn(
      '[partner] APP_SESSION_SECRET ausente - confiando no sender do cliente (dev). Ver BUG-H3.',
    )
    return { sender: clientSender }
  }

  const session = await resolveSessionAddress(req)
  if (!session) {
    return fail(
      401,
      'Sessão de carteira ausente ou expirada. Faça login novamente.',
      'SESSION_REQUIRED',
    )
  }
  if (clientSender && clientSender !== session.address) {
    return fail(403, 'sender não corresponde à carteira autenticada.', 'SENDER_MISMATCH')
  }
  return { sender: session.address }
}

/**
 * Exige uma sessão de carteira (prova-de-posse) para uma rota autenticada que
 * NÃO tem um `sender` no body (ex.: status/sync de KYC). Retorna o address
 * provado, ou uma NextResponse de erro. Em dev (sem APP_SESSION_SECRET) é no-op
 * e retorna null (rota segue aberta só no demo local).
 */
export async function requireSession(
  req: Request,
): Promise<{ address: string } | null | NextResponse> {
  if (!sessionConfigured()) {
    console.warn('[partner] APP_SESSION_SECRET ausente - rota sem sessão (dev).')
    return null
  }
  const session = await resolveSessionAddress(req)
  if (!session) {
    return fail(
      401,
      'Sessão de carteira ausente ou expirada. Faça login novamente.',
      'SESSION_REQUIRED',
    )
  }
  return { address: session.address }
}

/**
 * Resolve o `externalUserId` CONFIÁVEL para as rotas de KYC.
 *
 * Modo seguro (APP_SESSION_SECRET definido): exige o cookie de sessão e DERIVA o
 * externalUserId do address provado - ignorando qualquer valor do body. Fecha o
 * NEW-H2 (KYC anônimo com externalUserId escolhido pelo cliente / identity
 * poisoning).
 *
 * Modo dev (sem o segredo): usa o externalUserId do cliente (com aviso), para
 * não travar o demo local.
 */
export async function requireKycIdentity(
  req: Request,
  clientExternalUserId?: string,
): Promise<{ externalUserId: string } | NextResponse> {
  if (!sessionConfigured()) {
    console.warn(
      '[partner] APP_SESSION_SECRET ausente - KYC usando externalUserId do cliente (dev).',
    )
    if (!clientExternalUserId) return fail(400, 'externalUserId obrigatório.')
    return { externalUserId: clientExternalUserId }
  }
  const session = await resolveSessionAddress(req)
  if (!session) {
    return fail(
      401,
      'Sessão de carteira ausente ou expirada. Faça login novamente.',
      'SESSION_REQUIRED',
    )
  }
  return { externalUserId: session.address }
}

/**
 * Traduz exceções do partnerClient em respostas HTTP.
 *  - PartnerNotConfiguredError → 503
 *  - PartnerApiError           → status upstream (preserva 404/403/410/409…)
 *  - resto                     → 502
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof PartnerNotConfiguredError) {
    return fail(503, 'Partner API não configurada. Defina PARTNER_* no ambiente.', err.code)
  }
  if (err instanceof PartnerApiError) {
    return fail(err.status || 502, err.message, err.code)
  }
  const message = err instanceof Error ? err.message : 'Erro inesperado.'
  return fail(502, `Falha ao contatar a Partner API: ${message}`)
}
