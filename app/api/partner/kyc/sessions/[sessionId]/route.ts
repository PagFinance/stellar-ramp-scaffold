// app/api/partner/kyc/sessions/[sessionId]/route.ts
//
// Proxy para GET /api/v1/users/kyc/sessions/:sessionId (HMAC).
// Consulta o status de uma sessão de onboarding KYC/KYB.
import { NextResponse } from 'next/server'
import { kycSessionStatus } from '@/lib/partner/partnerClient'
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

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const limited = enforceRateLimit(req, 'kyc:session:status')
  if (limited) return limited

  // Exige sessão de carteira em modo seguro (bloqueia consulta anônima de status/PII).
  // Nota: sem persistência não dá para amarrar sessionId → dono; isto fecha o
  // acesso anônimo, não o IDOR por sessionId conhecido (ver docs/known-issues).
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session

  const { sessionId } = await params
  if (!sessionId) return fail(400, 'sessionId obrigatório.')

  try {
    const data = await kycSessionStatus(sessionId)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
