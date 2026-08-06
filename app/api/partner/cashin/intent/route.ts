// app/api/partner/cashin/intent/route.ts
//
// Proxy para POST /api/v1/cashin/intent (JWT + KYC, idempotente). Cria a
// cobrança Pix (brCode/qrCodeImage). Quando `quoteId` está presente, o valor é
// herdado do snapshot da cotação - o parceiro ignora o `amount` do body.
//
// O `sender` (pubkey) serve só para mintar o JWT server-side - NÃO vai no body
// upstream (a partner-api infere a wallet a partir do JWT).
import { NextResponse } from 'next/server'
import { cashinIntent } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSender,
} from '@/lib/partner/routeHelpers'
import type { CashinIntentRequest, CashinCustomer } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CUSTOMER_FIELDS = ['name', 'taxID', 'email', 'phone'] as const

/**
 * Normaliza os dados do pagador: apara os campos, descarta os vazios e devolve
 * `undefined` quando nada sobrou - aí `customer` nem entra no body upstream.
 */
function sanitizeCustomer(input?: CashinCustomer): CashinCustomer | undefined {
  if (!input || typeof input !== 'object') return undefined
  const filled = CUSTOMER_FIELDS.map(
    (k) => [k, typeof input[k] === 'string' ? input[k].trim() : ''] as const,
  ).filter(([, v]) => v.length > 0)
  return filled.length ? (Object.fromEntries(filled) as CashinCustomer) : undefined
}

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'cashin:intent')
  if (limited) return limited

  let body: {
    sender?: string
    amount?: number
    customer?: CashinCustomer
    quoteId?: string
    additionalInfo?: Array<{ key: string; value: string }>
    expiresIn?: number
    webhookUrl?: string
    comment?: string
  }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const { sender, amount, customer, quoteId } = body ?? {}
  if (!sender || sender.length < 10) return fail(400, 'sender (pubkey) obrigatório.')
  // Com quoteId o valor vem do snapshot; sem ele, amount é obrigatório.
  if (!quoteId && (typeof amount !== 'number' || amount <= 0)) {
    return fail(400, 'amount deve ser > 0 (BRL) quando não há quoteId.')
  }
  // Os dados do pagador são todos opcionais (nome, CPF/CNPJ, e-mail, telefone): a
  // cobrança Pix é criada sem customer vinculado na Woovi (o backend só anexa o
  // customer quando name E taxID vêm juntos). O QR é gerado normalmente. O formato
  // do taxID, quando informado, é validado pela partner-api.
  const cleanCustomer = sanitizeCustomer(customer)

  const idempotencyKey = req.headers.get('idempotency-key') ?? undefined

  const resolved = await requireSender(req, sender)
  if (resolved instanceof NextResponse) return resolved
  const trustedSender = resolved.sender

  const upstream: CashinIntentRequest = {
    amount: amount ?? 0,
    customer: cleanCustomer,
    quoteId,
    additionalInfo: body.additionalInfo,
    expiresIn: body.expiresIn,
    webhookUrl: body.webhookUrl,
    comment: body.comment,
  }

  try {
    const data = await cashinIntent(trustedSender, upstream, idempotencyKey)
    return ok(data, 201)
  } catch (err) {
    return handleError(err)
  }
}
