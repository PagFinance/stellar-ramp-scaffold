// app/api/partner/cashin/intent/[intentId]/route.ts
//
// Proxy para GET /api/v1/cashin/intent/:intentId (JWT). O pubkey vem em
// ?sender= para mintar o JWT server-side. `intentId === correlationID`.
import { NextResponse } from 'next/server'
import { cashinIntentStatus } from '@/lib/partner/partnerClient'
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
  const limited = enforceRateLimit(req, 'cashin:intent:status')
  if (limited) return limited

  const { intentId } = await params
  const sender = new URL(req.url).searchParams.get('sender') ?? ''

  if (!intentId) return fail(400, 'intentId obrigatório.')
  if (!sender || sender.length < 10) return fail(400, 'sender (query) obrigatório.')

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  try {
    const data = await cashinIntentStatus(trustedSender, intentId)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
