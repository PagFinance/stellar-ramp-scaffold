import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocka só a chamada de rede, preservando as classes de erro reais - a rota faz
// `instanceof PartnerApiError` para tratar o 422 do KYB.
vi.mock('@/lib/partner/partnerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/partner/partnerClient')>()
  return { ...actual, kycLegalPerson: vi.fn() }
})

import * as client from '@/lib/partner/partnerClient'
import { PartnerApiError } from '@/lib/partner/partnerClient'
import { POST } from '@/app/api/partner/kyc/legal-person/route'
import type { KycLegalPersonRequest, KycOwner } from '@/lib/partner/types'

const WALLET = '0x1234567890abcdef1234567890abcdef12345678'

const address = {
  postalCode: '01310100',
  street: 'Av Paulista',
  number: '1000',
  neighborhood: 'Bela Vista',
  city: 'Sao Paulo',
  state: 'SP',
}

function owner(patch: Partial<KycOwner> = {}): KycOwner {
  return {
    ownerType: 'LEGAL_REPRESENTATIVE',
    documentNumber: '12345678901',
    fullName: 'Maria Aparecida Souza',
    birthDate: '1985-04-12',
    motherName: 'Joana Souza',
    phoneNumber: '+5511999999999',
    email: 'maria@acme.com.br',
    address,
    ...patch,
  }
}

function body(patch: Partial<KycLegalPersonRequest> = {}): KycLegalPersonRequest {
  return {
    externalUserId: WALLET,
    // CNPJ real da Receita usado como vetor em todo o repo (checksum válido).
    documentNumber: '00000000000191',
    businessName: 'ACME COMERCIO DE SOFTWARE LTDA',
    tradingName: 'ACME',
    companyType: 'LTDA',
    contactNumber: '+551130000000',
    businessEmail: 'contato@acme.com.br',
    businessAddress: address,
    owners: [owner()],
    ...patch,
  }
}

function post(b: unknown) {
  return new Request('http://localhost/api/partner/kyc/legal-person', {
    method: 'POST',
    body: JSON.stringify(b),
    headers: { 'Content-Type': 'application/json' },
  })
}

const session = {
  sessionId: 's_1',
  externalUserId: WALLET,
  type: 'PJ',
  provider: 'bigdatacorp',
  providerSessionId: 'onb-1',
  providerTransactionId: 'tx-1',
  documentType: 'CNPJ',
  documentMasked: '00.***.***/****-91',
  country: 'BR',
  status: 'PENDING' as const,
  webViewUrl: 'https://bigid.example/onb-1',
  rejectionReason: null,
  representativeMasked: '123.***.***-01',
  companyVerification: {
    status: 'VERIFIED' as const,
    source: 'opencnpj',
    checkedAt: '2026-08-13T00:00:00.000Z',
    checks: [{ id: 'CNPJ_FOUND' as const, status: 'PASS' as const, message: 'ok' }],
  },
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  completedAt: null,
  lastSyncAt: null,
}

beforeEach(() => {
  vi.mocked(client.kycLegalPerson).mockReset()
  vi.mocked(client.kycLegalPerson).mockResolvedValue(session)
})

describe('POST /api/partner/kyc/legal-person', () => {
  it('cria a sessão KYB e devolve a verificação da empresa', async () => {
    const res = await POST(post(body()))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.companyVerification.status).toBe('VERIFIED')
    expect(json.data.representativeMasked).toBe('123.***.***-01')
  })

  it('recusa sem representante legal e NÃO chama a partner-api', async () => {
    const res = await POST(post(body({ owners: [owner({ ownerType: 'PARTNER' })] })))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.code).toBe('KYB_REPRESENTATIVE_MISSING')
    // O ponto: barrar aqui poupa a viagem até a API.
    expect(client.kycLegalPerson).not.toHaveBeenCalled()
  })

  it('aceita o papel BOTH como representante', async () => {
    const res = await POST(post(body({ owners: [owner({ ownerType: 'BOTH' })] })))
    expect(res.status).toBe(201)
  })

  it('repassa o 422 do KYB com os checks da empresa', async () => {
    const companyVerification = {
      status: 'REJECTED',
      source: 'opencnpj',
      checkedAt: '2026-08-13T00:00:00.000Z',
      checks: [
        { id: 'CNPJ_FOUND', status: 'PASS', message: 'ok' },
        { id: 'CNPJ_ACTIVE', status: 'FAIL', message: 'Empresa com situação cadastral "BAIXADA".' },
      ],
      rejectionReason: 'Empresa com situação cadastral "BAIXADA".',
    }
    vi.mocked(client.kycLegalPerson).mockRejectedValue(
      new PartnerApiError(422, 'Empresa reprovada.', 'KYB_COMPANY_REJECTED', {
        success: false,
        error: 'Empresa reprovada.',
        code: 'KYB_COMPANY_REJECTED',
        data: { companyVerification },
      }),
    )

    const res = await POST(post(body()))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.code).toBe('KYB_COMPANY_REJECTED')
    // Sem os checks a tela só teria a frase agregada e não saberia o que corrigir.
    expect(json.data.companyVerification.checks).toHaveLength(2)
    expect(json.data.companyVerification.status).toBe('REJECTED')
  })

  it('não vaza o payload upstream inteiro no 422 - só a verificação', async () => {
    vi.mocked(client.kycLegalPerson).mockRejectedValue(
      new PartnerApiError(422, 'Empresa reprovada.', 'KYB_COMPANY_REJECTED', {
        success: false,
        code: 'KYB_COMPANY_REJECTED',
        requestId: 'req-interno-123',
        data: { companyVerification: { status: 'REJECTED', checks: [] }, segredoInterno: 'x' },
      }),
    )

    const json = await (await POST(post(body()))).json()
    expect(Object.keys(json.data)).toEqual(['companyVerification'])
    expect(JSON.stringify(json)).not.toContain('req-interno-123')
  })

  it('mantém o 503 quando o registro da Receita está indisponível', async () => {
    vi.mocked(client.kycLegalPerson).mockRejectedValue(
      new PartnerApiError(503, 'Não foi possível consultar o CNPJ.', 'KYB_REGISTRY_UNAVAILABLE'),
    )

    const res = await POST(post(body()))
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.code).toBe('KYB_REGISTRY_UNAVAILABLE')
  })

  it('valida o corpo antes de sair da rota', async () => {
    expect((await POST(post(body({ documentNumber: '11111111111111' })))).status).toBe(400)
    expect((await POST(post(body({ businessEmail: 'nao-e-email' })))).status).toBe(400)
    expect((await POST(post(body({ owners: [] })))).status).toBe(400)
  })
})
