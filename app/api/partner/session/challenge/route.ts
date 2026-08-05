// app/api/partner/session/challenge/route.ts
//
// Emite um desafio de login de carteira: GET ?address=&blockchain= →
// { challengeToken, message }. A carteira assina `message` e o cliente troca
// pela sessão em POST /api/partner/session. Ver lib/server/partnerSession.ts.
import { NextResponse } from 'next/server'
import { issueChallenge, sessionConfigured } from '@/lib/server/partnerSession'
import { preflight, enforceRateLimit, ok, fail } from '@/lib/partner/routeHelpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'session:challenge')
  if (limited) return limited

  // Sem segredo (dev): informa que a sessão não é exigida.
  if (!sessionConfigured()) {
    return ok({ configured: false })
  }

  const url = new URL(req.url)
  const address = (url.searchParams.get('address') ?? '').trim()
  const blockchain = (url.searchParams.get('blockchain') ?? '').trim().toLowerCase()

  if (!address || address.length < 10) return fail(400, 'address obrigatório.')
  if (!blockchain) return fail(400, 'blockchain obrigatório.')

  const challenge = await issueChallenge(address, blockchain)
  if (!challenge) return fail(503, 'Sessão indisponível.')

  return ok({ configured: true, ...challenge })
}
