// app/api/partner/kyc/natural-person/route.ts
//
// Proxy para POST /api/v1/users/kyc/sessions/natural-person (HMAC).
// Onboarding KYC de pessoa física.
import { NextResponse } from 'next/server'
import { kycNaturalPerson } from '@/lib/partner/partnerClient'
import {
  preflight,
  enforceRateLimit,
  ok,
  fail,
  handleError,
  requireKycIdentity,
} from '@/lib/partner/routeHelpers'
import { isValidCPF, isValidEmail, isValidISODate } from '@/lib/partner/kycValidation'
import type { KycNaturalPersonRequest } from '@/lib/partner/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'kyc:natural-person')
  if (limited) return limited

  let body: Partial<KycNaturalPersonRequest>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'JSON inválido.')
  }

  // Identidade CONFIÁVEL: em modo seguro deriva o externalUserId da sessão de
  // carteira provada (ignora o do body) - fecha o NEW-H2 (KYC anônimo).
  const identity = await requireKycIdentity(req, body?.externalUserId)
  if (identity instanceof NextResponse) return identity

  if (!body?.documentNumber) return fail(400, 'documentNumber (CPF) obrigatório.')
  if (!body?.fullName) return fail(400, 'fullName obrigatório.')
  if (!body?.birthDate) return fail(400, 'birthDate obrigatório.')
  if (!body?.motherName) return fail(400, 'motherName obrigatório.')
  if (!body?.email) return fail(400, 'email obrigatório.')

  // Validação de formato (a validação autoritativa é da partner-api).
  if (!isValidCPF(body.documentNumber)) return fail(400, 'CPF inválido.')
  if (!isValidISODate(body.birthDate)) return fail(400, 'birthDate inválida (use YYYY-MM-DD).')
  if (!isValidEmail(body.email)) return fail(400, 'e-mail inválido.')

  try {
    const data = await kycNaturalPerson({
      ...(body as KycNaturalPersonRequest),
      externalUserId: identity.externalUserId,
    })
    return ok(data, 201)
  } catch (err) {
    return handleError(err)
  }
}
