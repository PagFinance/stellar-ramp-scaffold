// lib/partner/kycAutofill.ts
//
// Traduz o resultado de POST /api/partner/kyc/lookup para o estado dos
// formulários de KYC/KYB. Funções puras, sem React e sem I/O - toda a lógica de
// "o que dá para preencher e o que o usuário ainda precisa digitar" mora aqui,
// e é isto que os testes cobrem.
//
// Regra que atravessa o arquivo: campo ausente na consulta NUNCA vira string
// vazia sobrescrevendo algo que o usuário já digitou. O `patch` só carrega o que
// a fonte realmente informou.

import { maskCep } from '@/lib/partner/documentMask'
import type { AddressState } from '@/components/partner/kyc/fields'
import type {
  CompanyLookupData,
  PersonLookupData,
  LookupCompanyOwner,
  KycCompanyType,
  KycOwnerType,
} from '@/lib/partner/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * ISO ("1966-08-01T00:00:00.000Z") para o formato do <input type="date">.
 *
 * Fatia a string em vez de usar `new Date().toLocaleDateString()`: as datas da
 * consulta são ancoradas em meia-noite UTC, e converter para o fuso local
 * empurraria a data um dia para trás a oeste de Greenwich.
 */
export function isoToDateInput(iso?: string): string | undefined {
  if (!iso) return undefined
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : undefined
}

/** Junta DDD + número no formato E.164 usado pelos formulários (+5511999999999). */
export function formatPhoneE164(areaCode?: string, number?: string): string | undefined {
  const ac = (areaCode ?? '').replace(/\D/g, '')
  const n = (number ?? '').replace(/\D/g, '')
  if (!n) return undefined
  return ac ? `+55${ac}${n}` : `+55${n}`
}

/**
 * Deriva o tipo de empresa a partir da natureza jurídica / razão social.
 *
 * Conservador de propósito: só devolve um valor quando o texto é inequívoco.
 * Errar aqui submeteria um `companyType` divergente do contrato social, então na
 * dúvida devolve undefined e o usuário escolhe.
 */
export function inferCompanyType(data: CompanyLookupData): KycCompanyType | undefined {
  if (data.isMeiOptant === true) return 'MEI'

  // A natureza jurídica é AUTORITATIVA; a razão social é só um palpite de
  // sufixo. Juntar as duas num texto só classificaria "BANCO DO BRASIL SA" com
  // natureza "Sociedade Empresária Limitada" como SA, porque o sufixo do nome
  // casaria primeiro. Por isso a natureza é consultada sozinha, e o nome só
  // entra quando ela não decide.
  return (
    classifyLegalNature(data.legalNature?.description) ?? classifyByNameSuffix(data.officialName)
  )
}

function classifyLegalNature(description?: string): KycCompanyType | undefined {
  const t = (description ?? '').toUpperCase()
  if (!t) return undefined

  if (t.includes('EIRELI')) return 'EIRELI'
  if (t.includes('EMPRESARIA INDIVIDUAL') || t.includes('EMPRESÁRIA INDIVIDUAL')) return 'EI'
  if (t.includes('EMPRESARIO INDIVIDUAL') || t.includes('EMPRESÁRIO INDIVIDUAL')) return 'EI'
  if (t.includes('UNIPESSOAL')) return 'SLU'
  if (t.includes('ANONIMA') || t.includes('ANÔNIMA')) return 'SA'
  if (t.includes('LIMITADA') || t.includes('LTDA')) return 'LTDA'
  return undefined
}

/** Último recurso: o sufixo societário no FIM da razão social. */
function classifyByNameSuffix(officialName?: string): KycCompanyType | undefined {
  const t = (officialName ?? '').toUpperCase().trim()
  if (!t) return undefined

  if (/\bEIRELI\b\.?$/.test(t)) return 'EIRELI'
  if (/\bLTDA\b\.?$/.test(t) || /\bLIMITADA$/.test(t)) return 'LTDA'
  // "S.A.", "S/A", "SA" - só no fim, para não casar com iniciais no meio do nome.
  if (/\bS[./ ]?A\b\.?$/.test(t)) return 'SA'
  return undefined
}

/** Papel no QSA para o `ownerType` do formulário. */
export function mapOwnerRole(role?: string): KycOwnerType {
  const r = (role ?? '').toUpperCase()
  // "Sócio-Administrador" acumula as duas funções.
  if (r.includes('ADMINISTRADOR') && r.includes('SOCIO')) return 'BOTH'
  if (r.includes('ADMINISTRADOR') && r.includes('SÓCIO')) return 'BOTH'
  if (r.includes('PRESIDENTE') || r.includes('DIRETOR') || r.includes('ADMINISTRADOR')) {
    return 'LEGAL_REPRESENTATIVE'
  }
  return 'PARTNER'
}

// ── PF ───────────────────────────────────────────────────────────────────────

export interface NaturalPersonPatch {
  fullName?: string
  birthDate?: string
  motherName?: string
}

/** Campos do formulário PF que a consulta de CPF consegue preencher. */
export function personToFormPatch(data: PersonLookupData): NaturalPersonPatch {
  const patch: NaturalPersonPatch = {}
  if (data.name) patch.fullName = data.name
  const birthDate = isoToDateInput(data.birthDate)
  if (birthDate) patch.birthDate = birthDate
  if (data.motherName) patch.motherName = data.motherName
  return patch
}

/**
 * Impedimento cadastral que deve barrar o envio do KYC.
 *
 * Devolve a mensagem, ou null quando o CPF está apto. O óbito vem primeiro: é o
 * bloqueio mais grave e não deve ser mascarado pelo status.
 */
export function personBlockingIssue(data: PersonLookupData): string | null {
  if (data.hasObitIndication) {
    return 'A Receita Federal indica óbito para este CPF. Não é possível seguir com a verificação.'
  }
  const status = (data.taxIdStatus ?? '').toUpperCase()
  if (!status) return null
  if (status !== 'REGULAR') {
    return `CPF com situação cadastral "${data.taxIdStatus}". Regularize na Receita Federal antes de seguir.`
  }
  return null
}

// ── PJ ───────────────────────────────────────────────────────────────────────

export interface LegalPersonPatch {
  businessName?: string
  tradingName?: string
  businessEmail?: string
  contactNumber?: string
  companyType?: KycCompanyType
  businessAddress?: Partial<AddressState>
}

/** Campos do formulário PJ que a consulta de CNPJ consegue preencher. */
export function companyToFormPatch(data: CompanyLookupData): LegalPersonPatch {
  const patch: LegalPersonPatch = {}

  if (data.officialName) patch.businessName = data.officialName
  // Muita empresa não tem nome fantasia registrado; nesse caso a razão social é
  // o melhor preenchimento possível para um campo que o formulário exige.
  patch.tradingName = data.tradeName || data.officialName || undefined

  const email = data.emails?.find((e) => e.address)?.address
  if (email) patch.businessEmail = email

  // Ignora o número marcado como fax: o formulário pede telefone de contato.
  const phone = data.phones?.find((p) => p.number && p.isFax !== true) ?? data.phones?.[0]
  const contactNumber = formatPhoneE164(phone?.areaCode, phone?.number)
  if (contactNumber) patch.contactNumber = contactNumber

  const companyType = inferCompanyType(data)
  if (companyType) patch.companyType = companyType

  const a = data.address
  if (a) {
    const address: Partial<AddressState> = {}
    // Já sai mascarado para casar com o que o campo mostra ao digitar
    // (`toKycAddress` tira a máscara de novo no submit).
    if (a.zipCode) address.postalCode = maskCep(a.zipCode)
    if (a.street) address.street = a.street
    if (a.number) address.number = a.number
    if (a.complement) address.addressComplement = a.complement
    if (a.neighborhood) address.neighborhood = a.neighborhood
    if (a.city) address.city = a.city
    if (a.state) address.state = a.state.toUpperCase().slice(0, 2)
    if (Object.keys(address).length > 0) patch.businessAddress = address
  }

  return patch
}

export interface OwnerPrefill {
  ownerType: KycOwnerType
  fullName: string
  /** CPF parcial da Receita ("***345856**"), só para exibir. NUNCA vai no campo de CPF. */
  maskedDocument?: string
}

/**
 * Pré-preenchimento dos sócios a partir do QSA.
 *
 * O CPF fica de fora de propósito: a Receita só expõe o número PARCIAL
 * ("***345856**"), que reprovaria na validação de checksum do formulário. O
 * valor mascarado volta em `maskedDocument` apenas para a UI mostrar como pista
 * de qual sócio é qual.
 *
 * Pessoa jurídica no QSA também é descartada: o formulário de sócio pede CPF,
 * data de nascimento e nome da mãe, que não existem para uma empresa sócia.
 */
export function ownersFromQsa(owners?: LookupCompanyOwner[]): OwnerPrefill[] {
  if (!owners?.length) return []
  return owners
    .filter((o) => o.name && o.personType !== 'LEGAL')
    .map((o) => ({
      ownerType: mapOwnerRole(o.role),
      fullName: o.name!,
      ...(o.documentNumber ? { maskedDocument: o.documentNumber } : {}),
    }))
}

/** Impedimento cadastral que deve barrar o envio do KYB. Null quando apta. */
export function companyBlockingIssue(data: CompanyLookupData): string | null {
  const status = (data.taxIdStatus ?? '').toUpperCase()
  if (!status) return null
  // A Receita usa sufixos ("ATIVA - EMPRESA DOMICILIADA NO EXTERIOR"), então
  // compara por prefixo em vez de igualdade.
  if (status.startsWith('ATIVA')) return null
  return `CNPJ com situação cadastral "${data.taxIdStatus}". Apenas empresas ativas podem seguir com a verificação.`
}
