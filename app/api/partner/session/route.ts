// app/api/partner/session/route.ts
//
// Sessão de carteira (prova-de-posse) - fecha o BUG-H3.
//   GET    → { configured, address }  (estado da sessão atual)
//   POST   → valida desafio + assinatura, grava o cookie httpOnly de sessão
//   DELETE → encerra a sessão (limpa o cookie)
//
// Ver lib/server/partnerSession.ts.
import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionConfigured,
  verifyChallenge,
  verifyWalletSignature,
  issueSessionToken,
  resolveSessionAddress,
} from '@/lib/server/partnerSession'
import { preflight, enforceRateLimit, ok, fail } from '@/lib/partner/routeHelpers'
import { corsHeaders } from '@/lib/server/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function GET(req: Request) {
  if (!sessionConfigured()) return ok({ configured: false, address: null })
  const session = await resolveSessionAddress(req)
  return ok({ configured: true, address: session?.address ?? null })
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'session:login')
  if (limited) return limited

  if (!sessionConfigured()) {
    // Dev: sem segredo não há sessão a estabelecer.
    return ok({ ok: true, configured: false, address: null })
  }

  let body: {
    address?: string
    blockchain?: string
    publicKey?: string | null
    signature?: string
    challengeToken?: string
  }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const address = (body.address ?? '').trim()
  const blockchain = (body.blockchain ?? '').trim().toLowerCase()
  const signature = body.signature ?? ''
  const challengeToken = body.challengeToken ?? ''

  if (!address || address.length < 10) return fail(400, 'address obrigatório.')
  if (!blockchain) return fail(400, 'blockchain obrigatório.')
  if (!signature) return fail(400, 'signature obrigatória.')
  if (!challengeToken) return fail(400, 'challengeToken obrigatório.')

  const message = await verifyChallenge(challengeToken, address, blockchain)
  if (!message) return fail(400, 'Desafio inválido ou expirado.', 'CHALLENGE_INVALID')

  const valid = await verifyWalletSignature({
    blockchain,
    address,
    publicKey: body.publicKey ?? null,
    message,
    signature,
  })
  if (!valid)
    return fail(401, 'Assinatura inválida - posse da carteira não comprovada.', 'SIGNATURE_INVALID')

  const token = await issueSessionToken(address)
  if (!token) return fail(503, 'Sessão indisponível.')

  const res = NextResponse.json(
    { success: true, error: null, data: { ok: true, address } },
    { status: 200, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}

export async function DELETE(req: Request) {
  const res = NextResponse.json(
    { success: true, error: null, data: { ok: true } },
    { status: 200, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
