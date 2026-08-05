// app/api/partner/cashout/quote/route.ts
//
// Proxy para POST /api/v1/cashout/quote da Partner API. A rota upstream exige
// JWT do usuário (sender) + KYC aprovado, além dos headers x-app-*; o JWT é
// mintado server-side a partir do `sender` (o cliente nunca vê PARTNER_*).
import { NextResponse } from 'next/server'
import { cashoutQuote } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSender,
} from '@/lib/partner/routeHelpers'
import type { CashoutQuoteRequest } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'cashout:quote')
  if (limited) return limited

  let body: Partial<CashoutQuoteRequest>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const { assetId, amount, externalId, sender, invoiceCode } = body ?? {}
  if (typeof assetId !== 'number') return fail(400, 'assetId (number) obrigatório.')
  if (typeof amount !== 'number' || amount <= 0) return fail(400, 'amount deve ser > 0.')
  if (!externalId) return fail(400, 'externalId obrigatório.')
  if (!sender) return fail(400, 'sender obrigatório.')
  if (!invoiceCode) return fail(400, 'invoiceCode obrigatório.')

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  try {
    // O sender confiável (da sessão) vai tanto no JWT quanto no body upstream.
    const data = await cashoutQuote(trustedSender, {
      ...(body as CashoutQuoteRequest),
      sender: trustedSender,
    })
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
