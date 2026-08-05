// app/api/partner/validate-code/route.ts
//
// Proxy para POST /api/v1/validate-code (público). Valida/parseia código Pix ou
// boleto antes de gerar a quote de cash-out.
import { validateCode } from '@/lib/partner/partnerClient'
import { preflight, enforceRateLimit, ok, fail, handleError } from '@/lib/partner/routeHelpers'
import type { ValidateCodeRequest } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'validate-code')
  if (limited) return limited

  let body: Partial<ValidateCodeRequest>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  if (!body?.code || body.code.length < 5) return fail(400, 'code inválido (min 5 chars).')

  try {
    const data = await validateCode(body as ValidateCodeRequest)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
