// app/api/partner/cashout/intent/route.ts
//
// Proxy para POST /api/v1/cashout/intent (JWT + KYC). O JWT do usuário é
// mintado server-side a partir do `sender` (pubkey da wallet conectada).
import { NextResponse } from 'next/server'
import { cashoutIntent } from '@/lib/partner/partnerClient'
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

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'cashout:intent')
  if (limited) return limited

  let body: { quoteId?: string; sender?: string; webhookUrl?: string }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const { quoteId, sender, webhookUrl } = body ?? {}
  if (!quoteId || quoteId.length < 8) return fail(400, 'quoteId inválido.')
  if (!sender || sender.length < 10) return fail(400, 'sender inválido.')

  const idempotencyKey = req.headers.get('idempotency-key') ?? undefined

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  try {
    const data = await cashoutIntent(
      trustedSender,
      { quoteId, sender: trustedSender, webhookUrl },
      idempotencyKey,
    )
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
