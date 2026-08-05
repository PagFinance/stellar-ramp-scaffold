// app/api/partner/kyc/lookup/route.ts
//
// Proxy para POST /api/v1/users/kyc/lookup (HMAC).
// Consulta cadastral de CPF/CNPJ, usada para preencher automaticamente os
// formulários de KYC/KYB.
//
// Exige a sessão de carteira igual às demais rotas KYC: sem isso a rota seria um
// oráculo anônimo de consulta de documentos rodando na conta do parceiro (a
// cadeia do lado do parceiro cai num provider PAGO quando o gratuito falha, e
// CPF não é dado público).
import { NextResponse } from 'next/server'
import { kycLookup } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireSession,
} from '@/lib/partner/routeHelpers'
import { isValidCPF, isValidCNPJ, onlyDigits, onlyCnpjChars } from '@/lib/partner/kycValidation'
import type { DocumentLookupRequest, KycDocumentType } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPPORTED: KycDocumentType[] = ['CPF', 'CNPJ']

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'kyc:lookup')
  if (limited) return limited

  const session = await requireSession(req)
  if (session instanceof NextResponse) return session

  let body: Partial<DocumentLookupRequest>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  const documentType = body?.documentType
  if (!documentType || !SUPPORTED.includes(documentType)) {
    return fail(400, `documentType inválido. Valores aceitos: ${SUPPORTED.join(', ')}.`)
  }
  if (!body?.documentNumber || typeof body.documentNumber !== 'string') {
    return fail(400, 'documentNumber obrigatório.')
  }

  // Normalização POR TIPO. CPF é só dígito; CNPJ é alfanumérico nos 12 primeiros
  // caracteres desde a IN RFB nº 2.229/2024, então `onlyDigits` apagaria as
  // letras e mandaria um documento mutilado para a Partner API.
  const normalized =
    documentType === 'CNPJ' ? onlyCnpjChars(body.documentNumber) : onlyDigits(body.documentNumber)

  // Valida o checksum antes de gastar a chamada upstream: um documento
  // malformado nunca vai existir na base da Receita.
  if (documentType === 'CPF' && !isValidCPF(normalized)) return fail(400, 'CPF inválido.')
  if (documentType === 'CNPJ' && !isValidCNPJ(normalized)) return fail(400, 'CNPJ inválido.')

  try {
    const data = await kycLookup({
      documentType,
      documentNumber: normalized,
      country: body.country ?? 'BR',
    })
    return ok(data)
  } catch (err) {
    return handleError(err)
  }
}
