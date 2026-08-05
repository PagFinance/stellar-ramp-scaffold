// app/api/partner/cashout/intent/[intentId]/route.ts
//
// Proxy para GET /api/v1/cashout/intent/:intentId (JWT). O pubkey vem em ?sender=
// para mintar o JWT server-side.
import { NextResponse } from 'next/server'
import { cashoutIntentStatus } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSender,
} from '@/lib/partner/routeHelpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function GET(req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const limited = enforceRateLimit(req, 'cashout:intent:status')
  if (limited) return limited

  const { intentId } = await params
  const sender = new URL(req.url).searchParams.get('sender') ?? ''

  if (!intentId || intentId.length < 8) return fail(400, 'intentId inválido.')
  if (!sender || sender.length < 10) return fail(400, 'sender (query) obrigatório.')

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  try {
    const data = await cashoutIntentStatus(trustedSender, intentId)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
