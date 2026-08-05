import { describe, it, expect } from 'vitest'
import {
  isoToDateInput,
  formatPhoneE164,
  inferCompanyType,
  mapOwnerRole,
  personToFormPatch,
  personBlockingIssue,
  companyToFormPatch,
  companyBlockingIssue,
  ownersFromQsa,
} from '@/lib/partner/kycAutofill'
import type { CompanyLookupData, PersonLookupData } from '@/lib/partner/types'

// Recorte fiel do que POST /api/v1/users/kyc/lookup devolve para o CNPJ do
// Banco do Brasil (00000000000191), capturado da api.opencnpj.org.
const company: CompanyLookupData = {
  documentType: 'CNPJ',
  documentNumber: '00000000000191',
  country: 'BR',
  officialName: 'BANCO DO BRASIL SA',
  tradeName: 'DIRECAO GERAL',
  foundedDate: '1966-08-01T00:00:00.000Z',
  taxIdStatus: 'ATIVA',
  taxIdStatusDate: '2005-11-03T00:00:00.000Z',
  isHeadquarter: true,
  companySize: 'Demais',
  isSimplesOptant: false,
  isMeiOptant: false,
  shareCapitalCents: 12_000_000_000_000,
  legalNature: { description: 'Sociedade de Economia Mista' },
  mainActivity: { code: '6422100', description: 'Bancos múltiplos, com carteira comercial' },
  secondaryActivities: [{ code: '6499999', description: 'Outras atividades' }],
  address: {
    street: 'QUADRA SAUN QUADRA 5 BLOCO B',
    number: 'SN',
    complement: 'ANDAR T I',
    neighborhood: 'ASA NORTE',
    city: 'BRASILIA',
    state: 'DF',
    zipCode: '70040912',
    country: 'BRASIL',
  },
  phones: [
    { areaCode: '61', number: '34939002', isFax: false },
    { areaCode: '61', number: '34931040', isFax: true },
  ],
  emails: [{ address: 'secex@bb.com.br' }],
  owners: [
    {
      name: 'FELIPE GUIMARAES GEISSLER PRINCE',
      documentNumber: '***345856**',
      role: 'Diretor',
      joinedAt: '2020-07-10T00:00:00.000Z',
      personType: 'NATURAL',
      ageRange: '41 a 50 anos',
    },
    {
      name: 'TARCIANA PAULA GOMES MEDEIROS',
      documentNumber: '***128734**',
      role: 'Presidente',
      personType: 'NATURAL',
    },
  ],
}

const person: PersonLookupData = {
  documentType: 'CPF',
  documentNumber: '150.***.***-94',
  country: 'BR',
  name: 'VICENTE NASCIMENTO',
  commonName: 'VICENTE N',
  birthDate: '1996-08-05T00:00:00.000Z',
  age: 29,
  gender: 'M',
  motherName: 'LEDA OLIVEIRA',
  taxIdStatus: 'REGULAR',
  hasObitIndication: false,
}

describe('helpers de formato', () => {
  it('isoToDateInput corta o ISO sem escorregar de fuso', () => {
    // Converter via Date local empurraria para 1966-07-31 a oeste de Greenwich.
    expect(isoToDateInput('1966-08-01T00:00:00.000Z')).toBe('1966-08-01')
    expect(isoToDateInput(undefined)).toBeUndefined()
    expect(isoToDateInput('nao-e-data')).toBeUndefined()
  })

  it('formatPhoneE164 monta o formato que o formulário espera', () => {
    expect(formatPhoneE164('61', '34939002')).toBe('+556134939002')
    expect(formatPhoneE164(undefined, '34939002')).toBe('+5534939002')
    expect(formatPhoneE164('61', undefined)).toBeUndefined()
  })
})

describe('inferCompanyType', () => {
  it('deriva dos textos inequívocos', () => {
    expect(
      inferCompanyType({ ...company, legalNature: { description: 'Sociedade Anônima Fechada' } }),
    ).toBe('SA')
    expect(
      inferCompanyType({
        ...company,
        legalNature: { description: 'Sociedade Empresária Limitada' },
      }),
    ).toBe('LTDA')
    expect(
      inferCompanyType({
        ...company,
        legalNature: { description: 'Empresa Individual de Resp. Ltda (EIRELI)' },
      }),
    ).toBe('EIRELI')
    expect(
      inferCompanyType({ ...company, legalNature: { description: 'Sociedade Unipessoal' } }),
    ).toBe('SLU')
  })

  it('optante do MEI vence a heurística de texto', () => {
    expect(inferCompanyType({ ...company, isMeiOptant: true })).toBe('MEI')
  })

  // Regressão: juntar natureza jurídica e razão social num texto só fazia o
  // sufixo "SA" de "BANCO DO BRASIL SA" ganhar de uma natureza "Limitada".
  it('a natureza jurídica manda mais que o sufixo da razão social', () => {
    expect(
      inferCompanyType({
        ...company,
        officialName: 'BANCO DO BRASIL SA',
        legalNature: { description: 'Sociedade Empresária Limitada' },
      }),
    ).toBe('LTDA')
  })

  it('cai no sufixo do nome só quando a natureza não decide', () => {
    const base = { ...company, legalNature: undefined, isMeiOptant: undefined }
    expect(inferCompanyType({ ...base, officialName: 'PADARIA DO ZE LTDA' })).toBe('LTDA')
    expect(inferCompanyType({ ...base, officialName: 'BANCO DO BRASIL S.A.' })).toBe('SA')
    // "SA" no meio do nome não é sufixo societário.
    expect(
      inferCompanyType({ ...base, officialName: 'SA PAULO COMERCIO DE ALIMENTOS' }),
    ).toBeUndefined()
  })

  it('na dúvida não chuta - o usuário escolhe', () => {
    expect(
      inferCompanyType({
        ...company,
        officialName: undefined,
        legalNature: { description: 'Sociedade de Economia Mista' },
        isMeiOptant: undefined,
      }),
    ).toBeUndefined()
  })
})

describe('mapOwnerRole', () => {
  it('mapeia os papéis do QSA', () => {
    expect(mapOwnerRole('Sócio-Administrador')).toBe('BOTH')
    expect(mapOwnerRole('Diretor')).toBe('LEGAL_REPRESENTATIVE')
    expect(mapOwnerRole('Presidente')).toBe('LEGAL_REPRESENTATIVE')
    expect(mapOwnerRole('Sócio')).toBe('PARTNER')
    expect(mapOwnerRole(undefined)).toBe('PARTNER')
  })
})

describe('PF - consulta de CPF', () => {
  it('preenche os três campos que o formulário pede', () => {
    expect(personToFormPatch(person)).toEqual({
      fullName: 'VICENTE NASCIMENTO',
      birthDate: '1996-08-05',
      motherName: 'LEDA OLIVEIRA',
    })
  })

  it('não inventa campo que a fonte não informou', () => {
    const patch = personToFormPatch({ ...person, motherName: undefined, birthDate: undefined })
    expect(patch).toEqual({ fullName: 'VICENTE NASCIMENTO' })
    expect('motherName' in patch).toBe(false)
  })

  it('CPF regular não bloqueia', () => {
    expect(personBlockingIssue(person)).toBeNull()
  })

  it('óbito bloqueia, e vence o status', () => {
    const issue = personBlockingIssue({
      ...person,
      hasObitIndication: true,
      taxIdStatus: 'REGULAR',
    })
    expect(issue).toMatch(/óbito/i)
  })

  it('CPF não regular bloqueia', () => {
    expect(personBlockingIssue({ ...person, taxIdStatus: 'SUSPENSA' })).toMatch(/SUSPENSA/)
  })

  it('status ausente não bloqueia (não afirma o que a fonte não disse)', () => {
    expect(personBlockingIssue({ ...person, taxIdStatus: undefined })).toBeNull()
  })
})

describe('PJ - consulta de CNPJ', () => {
  const patch = companyToFormPatch(company)

  it('preenche razão social, fantasia, e-mail e telefone', () => {
    expect(patch.businessName).toBe('BANCO DO BRASIL SA')
    expect(patch.tradingName).toBe('DIRECAO GERAL')
    expect(patch.businessEmail).toBe('secex@bb.com.br')
  })

  it('ignora o número marcado como fax ao escolher o telefone de contato', () => {
    expect(patch.contactNumber).toBe('+556134939002')
  })

  it('preenche o endereço inteiro, com o CEP já mascarado', () => {
    expect(patch.businessAddress).toEqual({
      postalCode: '70040-912',
      street: 'QUADRA SAUN QUADRA 5 BLOCO B',
      number: 'SN',
      addressComplement: 'ANDAR T I',
      neighborhood: 'ASA NORTE',
      city: 'BRASILIA',
      state: 'DF',
    })
  })

  it('cai na razão social quando não há nome fantasia (o campo é obrigatório)', () => {
    const p = companyToFormPatch({ ...company, tradeName: undefined })
    expect(p.tradingName).toBe('BANCO DO BRASIL SA')
  })

  it('não sobrescreve com vazio o que a fonte não informou', () => {
    const p = companyToFormPatch({
      ...company,
      emails: undefined,
      phones: undefined,
      address: undefined,
    })
    expect('businessEmail' in p).toBe(false)
    expect('contactNumber' in p).toBe(false)
    expect('businessAddress' in p).toBe(false)
  })

  it('empresa ativa não bloqueia, inclusive com sufixo da Receita', () => {
    expect(companyBlockingIssue(company)).toBeNull()
    expect(
      companyBlockingIssue({ ...company, taxIdStatus: 'ATIVA - EMPRESA DOMICILIADA NO EXTERIOR' }),
    ).toBeNull()
  })

  it('empresa baixada bloqueia', () => {
    expect(companyBlockingIssue({ ...company, taxIdStatus: 'BAIXADA' })).toMatch(/BAIXADA/)
  })
})

describe('QSA - pré-preenchimento dos sócios', () => {
  const prefills = ownersFromQsa(company.owners)

  it('importa um bloco por sócio, com nome e papel', () => {
    expect(prefills).toHaveLength(2)
    expect(prefills[0]).toMatchObject({
      fullName: 'FELIPE GUIMARAES GEISSLER PRINCE',
      ownerType: 'LEGAL_REPRESENTATIVE',
      maskedDocument: '***345856**',
    })
  })

  // O ponto central: preencher o CPF mascarado reprovaria na validação de
  // checksum do formulário e o usuário teria que apagar antes de digitar.
  it('NUNCA devolve o CPF mascarado como documento utilizável', () => {
    for (const p of prefills) {
      expect(p).not.toHaveProperty('documentNumber')
      expect(p.maskedDocument).toMatch(/\*/)
    }
  })

  it('descarta sócio pessoa jurídica (o formulário pede CPF e nome da mãe)', () => {
    const withCompanyOwner = ownersFromQsa([
      ...company.owners!,
      { name: 'HOLDING XYZ LTDA', personType: 'LEGAL', role: 'Sócio' },
    ])
    expect(withCompanyOwner).toHaveLength(2)
    expect(withCompanyOwner.map((o) => o.fullName)).not.toContain('HOLDING XYZ LTDA')
  })

  it('QSA ausente (fallback pago) devolve lista vazia, sem quebrar', () => {
    expect(ownersFromQsa(undefined)).toEqual([])
    expect(ownersFromQsa([])).toEqual([])
  })
})
