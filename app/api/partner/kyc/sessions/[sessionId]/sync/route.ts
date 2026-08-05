// app/api/partner/kyc/sessions/[sessionId]/sync/route.ts
//
// Proxy para POST /api/v1/users/kyc/sessions/:sessionId/sync (HMAC).
// Força atualização do status da sessão com o provider externo.
import { NextResponse } from 'next/server'
import { kycSyncSession } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSession,
} from '@/lib/partner/routeHelpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const limited = enforceRateLimit(req, 'kyc:session:sync')
  if (limited) return limited

  // Exige sessão de carteira em modo seguro (bloqueia sync anônimo).
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session

  const { sessionId } = await params
  if (!sessionId) return fail(400, 'sessionId obrigatório.')

  try {
    const data = await kycSyncSession(sessionId)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
