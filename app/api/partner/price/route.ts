// app/api/partner/price/route.ts
//
// Proxy para GET /api/v1/getAssetPrice (público). Preço do ativo com spread.
import { assetPrice } from '@/lib/partner/partnerClient'
import { preflight, enforceRateLimit, ok, fail, handleError } from '@/lib/partner/routeHelpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'price')
  if (limited) return limited

  const sp = new URL(req.url).searchParams
  const assetId = sp.get('assetId') ?? sp.get('asset')
  const fiatCurrency = sp.get('fiatCurrency') ?? 'BRL'

  if (!assetId) return fail(400, 'assetId (query) obrigatório.')

  try {
    const data = await assetPrice(assetId, fiatCurrency)
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
