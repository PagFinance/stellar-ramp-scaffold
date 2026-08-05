// app/api/partner/cashin/quote/route.ts
//
// Proxy para POST /api/v1/cashin/quote (JWT + KYC). Cotação fiat → cripto: dado
// um valor em BRL, estima quanta cripto o usuário recebe e devolve um `quoteId`
// de uso único que amarra a cobrança seguinte ao preço cotado.
//
// O `sender` (pubkey) serve só para mintar o JWT server-side - NÃO vai no body
// upstream (a partner-api infere a wallet a partir do JWT).
import { NextResponse } from 'next/server'
import { cashinQuote } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSender,
} from '@/lib/partner/routeHelpers'
import type { CashinQuoteRequest } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'cashin:quote')
  if (limited) return limited

  let body: {
    sender?: string
    amount?: number
    assetId?: number
    fiatCurrency?: string
    externalId?: string
    destinationWallet?: string
  }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const { sender, amount } = body ?? {}
  if (!sender || sender.length < 10) return fail(400, 'sender (pubkey) obrigatório.')
  if (typeof amount !== 'number' || amount <= 0) return fail(400, 'amount deve ser > 0 (BRL).')

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  const upstream: CashinQuoteRequest = {
    amount,
    assetId: body.assetId,
    fiatCurrency: body.fiatCurrency,
    externalId: body.externalId,
    destinationWallet: body.destinationWallet,
  }

  try {
    const data = await cashinQuote(trustedSender, upstream)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
