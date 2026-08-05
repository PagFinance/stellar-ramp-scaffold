// app/api/partner/accepted-cryptos/route.ts
//
// Proxy para GET /api/v1/accepted-cryptos?chain= (público). Lista de assets
// aceitos por chain - usado para popular o seletor de ativos do cash-out.
import { acceptedCryptos } from '@/lib/partner/partnerClient'
import { preflight, enforceRateLimit, ok, fail, handleError } from '@/lib/partner/routeHelpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'accepted-cryptos')
  if (limited) return limited

  const chain = new URL(req.url).searchParams.get('chain')
  if (!chain) return fail(400, 'chain (query) obrigatório.')

  try {
    const data = await acceptedCryptos(chain)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
