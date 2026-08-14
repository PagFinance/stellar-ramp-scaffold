// app/api/partner/kyc/legal-person/route.ts
//
// Proxy para POST /api/v1/users/kyc/sessions/legal-person (HMAC).
// Onboarding KYB de pessoa jurídica.
import { NextResponse } from 'next/server'
import { kycLegalPerson, PartnerApiError } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireKycIdentity,
} from '@/lib/partner/routeHelpers'
import { isValidCNPJ, isValidEmail } from '@/lib/partner/kycValidation'
import type { KycLegalPersonRequest } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'kyc:legal-person')
  if (limited) return limited

  let body: Partial<KycLegalPersonRequest>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  // Identidade CONFIÁVEL derivada da sessão de carteira em modo seguro (NEW-H2).
  const identity = await requireKycIdentity(req, body?.externalUserId)
  if (identity instanceof NextResponse) return identity

  if (!body?.documentNumber) return fail(400, 'documentNumber (CNPJ) obrigatório.')
  if (!body?.businessName) return fail(400, 'businessName obrigatório.')
  if (!body?.tradingName) return fail(400, 'tradingName obrigatório.')
  if (!body?.companyType) return fail(400, 'companyType obrigatório.')
  if (!body?.contactNumber) return fail(400, 'contactNumber obrigatório.')
  if (!body?.businessEmail) return fail(400, 'businessEmail obrigatório.')
  if (!body?.businessAddress) return fail(400, 'businessAddress obrigatório.')
  if (!Array.isArray(body?.owners) || body.owners.length < 1) {
    return fail(400, 'owners: informe ao menos 1 sócio/representante.')
  }
  // O KYB verifica a identidade de QUEM ASSINA pela empresa: sem representante
  // legal não há ninguém para verificar. A partner-api recusa igual (400
  // KYB_REPRESENTATIVE_MISSING); barrar aqui evita a viagem e devolve o mesmo
  // código, para a tela tratar um caso só.
  if (
    !body.owners.some((o) => o?.ownerType === 'LEGAL_REPRESENTATIVE' || o?.ownerType === 'BOTH')
  ) {
    return fail(
      400,
      'Marque ao menos um sócio como representante legal (papel "Representante legal" ou "Sócio e representante").',
      'KYB_REPRESENTATIVE_MISSING',
    )
  }

  // Validação de formato (a validação autoritativa é da partner-api).
  if (!isValidCNPJ(body.documentNumber)) return fail(400, 'CNPJ inválido.')
  if (!isValidEmail(body.businessEmail)) return fail(400, 'e-mail comercial inválido.')

  try {
    const data = await kycLegalPerson({
      ...(body as KycLegalPersonRequest),
      externalUserId: identity.externalUserId,
    })
    return ok(data, 201)
  } catch (err) {
    // 422 KYB_COMPANY_REJECTED carrega os checks da empresa - é a única
    // informação que o formulário precisa para dizer o que reprovou (CNPJ
    // baixado, razão social divergente, representante fora do QSA). Repassamos
    // só esse bloco, nunca o payload upstream inteiro.
    if (err instanceof PartnerApiError && err.code === 'KYB_COMPANY_REJECTED') {
      const verification = (err.payload as { data?: { companyVerification?: unknown } } | undefined)
        ?.data?.companyVerification
      return fail(
        422,
        err.message,
        err.code,
        verification ? { companyVerification: verification } : undefined,
      )
    }
    return handleError(err)
  }
}
