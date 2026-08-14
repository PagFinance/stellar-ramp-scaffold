// lib/partner/types.ts
//
// DTOs da PagFinance Partner API (/api/v1). Envelope padrão
// `{ success, error, data }` (validate-code usa `message` no lugar de `error`).
//
// Estes tipos são compartilhados entre o cliente server-only (lib/partner/*) e
// o cliente de browser (lib/partner/browserClient.ts) - por isso este arquivo
// NÃO importa 'server-only'.

import type { AssetType } from '@/lib/types/AssetType'

// ── Envelope ──────────────────────────────────────────────────────────────
export interface PartnerEnvelope<T> {
  success: boolean
  error: string | null
  data: T
}

/** Envelope alternativo usado por validate-code / receipts. */
export interface PartnerMessageEnvelope<T> {
  success: boolean
  message: string | null
  data: T
}

// ── valuesAndFees (PaymentValuesType da partner-api) ───────────────────────
export interface ValuesAndFees {
  paymentInFiat: number
  paymentInCrypto: number
  networkFeeFiat: number
  networkFeeCrypto: number
  processingFeeFiat: number
  processingFeeCrypto: number
  totalFeeFiat: number
  totalFeeCrypto: number
  totalFiat: number
  totalCrypto: number
}

// ── Cash-out: quote ────────────────────────────────────────────────────────
export interface CashoutQuoteRequest {
  assetId: number
  amount: number
  externalId: string
  sender: string
  invoiceCode: string
  fiatCurrency?: string
  invoiceType?: string
  invoiceTransferType?: string
  invoiceName?: string
  userTaxId?: string
  userEmail?: string
  message?: string
  referCode?: string | null
  webhookUrl?: string
}

export interface CashoutQuotePriceContext {
  pair: string
  price: number
  priceAfterDiscount: number
  discountAppliedBps: number
  feeFloor: number
  feePercentApplied: number
  updated_at: string
}

/** priceContext de cotação - mesma forma em cash-in e cash-out. */
export type QuotePriceContext = CashoutQuotePriceContext

export interface CashoutQuoteResponse {
  quoteId: string
  expiresAt: string
  ttlSeconds: number
  valuesAndFees: ValuesAndFees
  priceContext: CashoutQuotePriceContext
  baasEnabled: boolean
  app: { version: string; name: string; domain: string }
}

// ── Cash-out: intent ───────────────────────────────────────────────────────
export interface CashoutIntentRequest {
  quoteId: string
  sender: string
  webhookUrl?: string
}

export interface CashoutIntentResponse {
  intentId: string
  memo: string
  blockchain: string
  /** Instrução para a wallet assinar: base64 (Solana) ou { to,value,data } (EVM). */
  instruction: unknown
  minContextSlot: unknown | null
  receiver: string
  amount: number
  expiresAt: string
}

export type CashoutIntentStatusValue = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED'

export interface CashoutIntentStatus {
  intentId: string
  status: CashoutIntentStatusValue
  invoiceCode?: string
  invoiceType?: string
  invoiceValue?: number
  invoiceCurrency?: string
  baasTransactionId?: string | null
  baasStatus?: string | null
  createdAt?: string
  updatedAt?: string
  confirmedAt?: string | null
  baasDispatchedAt?: string | null
}

// ── Cash-in (onramp: fiat → cripto) ──────────────────────────────────────────
export interface CashinCustomer {
  /** Nome do pagador. Opcional - a partner-api gera a cobrança Pix sem ele. */
  name?: string
  /** CPF/CNPJ do pagador. Opcional - a partner-api gera a cobrança Pix sem ele. */
  taxID?: string
  email?: string
  phone?: string
}

/**
 * Cotação de cash-in (`POST /api/v1/cashin/quote`, JWT + KYC). Estima quanta
 * cripto o usuário recebe pagando `amount` em BRL. Devolve um `quoteId` de uso
 * único (TTL curto) que amarra a `intent` seguinte ao preço cotado.
 */
export interface CashinQuoteRequest {
  amount: number
  /** Ativo desejado; default do parceiro = 1 (USDC). */
  assetId?: number
  fiatCurrency?: string
  externalId?: string
  /** Opcional; se enviado, o parceiro valida o formato contra a chain do ativo. */
  destinationWallet?: string
}

export interface CashinQuoteResponse {
  quoteId: string
  expiresAt: string
  ttlSeconds: number
  valuesAndFees: ValuesAndFees
  priceContext: QuotePriceContext
}

/**
 * Criação da cobrança Pix (`POST /api/v1/cashin/intent`, JWT + KYC, idempotente).
 * Quando `quoteId` está presente, o `amount` é herdado do snapshot da cotação
 * (o parceiro ignora o `amount` do body).
 */
export interface CashinIntentRequest {
  amount: number
  /** Dados do pagador. Todo o bloco é opcional - omitido quando nada foi preenchido. */
  customer?: CashinCustomer
  /** Amarra a cobrança a uma cotação prévia (uso único). */
  quoteId?: string
  additionalInfo?: Array<{ key: string; value: string }>
  expiresIn?: number
  webhookUrl?: string
  comment?: string
}

export interface CashinIntentResponse {
  /** Chave canônica de consulta. `intentId === correlationID`. */
  intentId: string
  id: string
  correlationID: string
  status: string
  valueCents: number
  brCode: string
  qrCodeImage: string
  paymentLinkUrl: string
  expiresIn: number
  splitApplied: boolean
  splitValueCents: number
  quoteId?: string | null
  /** Estimativa de cripto a creditar (presente quando amarrada a uma cotação). */
  cryptoEstimate?: number
  createdAt: string
}

/** Registro completo devolvido no GET de status da cobrança. */
export interface CashinIntentStatus {
  intentId?: string
  correlationID: string
  status: string
  valueCents?: number
  brCode?: string
  qrCodeImage?: string
  createdAt?: string
  paidAt?: string | null
  [key: string]: unknown
}

// ── Preço ──────────────────────────────────────────────────────────────────
export interface AssetPrice {
  price: number
  pair: string
  baseCurrency: string
  quoteCurrency: string
  updated_at: string
  cached: boolean
  cacheAge?: number
}

// ── Accepted cryptos ────────────────────────────────────────────────────────
// A partner-api retorna um BlockchainType com a lista de assets aceitos.
export interface AcceptedCryptos {
  id?: number
  name: string
  symbol?: string
  explorer?: string
  icon?: string | null
  status?: boolean
  assets: AssetType[]
}

// ── Validate code ────────────────────────────────────────────────────────────
export interface ValidateCodeRequest {
  code: string
  account?: string
  documentNumber?: string
}

/** O `data` é um objeto de transferência (chave Pix / boleto parseado). */
export type ValidatedTransfer = Record<string, unknown>

// ── KYC / KYB (onboarding PF / PJ) ───────────────────────────────────────────
// Contratos de /api/v1/users/kyc/* (HMAC). Ver partner-api-v1/src/modules/users/kyc.

export interface KycAddress {
  postalCode: string // 8-9 chars (CEP)
  street: string
  number: string
  addressComplement?: string
  neighborhood: string
  city: string
  state: string // UF, 2 chars
}

/** Pessoa física (KYC). documentNumber = CPF. */
export interface KycNaturalPersonRequest {
  externalUserId: string
  documentNumber: string
  country?: string // ISO-2, default BR
  fullName: string
  socialName?: string
  birthDate: string // ex.: 1990-05-20
  motherName: string
  phoneNumber?: string
  email: string
  address?: KycAddress
  isPoliticallyExposedPerson?: boolean
  webhookUrl?: string
}

export type KycOwnerType = 'PARTNER' | 'LEGAL_REPRESENTATIVE' | 'BOTH'
export type KycCompanyType = 'MEI' | 'EI' | 'EIRELI' | 'LTDA' | 'SA' | 'SLU'

/** Sócio/representante (obrigatório no KYB). documentNumber = CPF. */
export interface KycOwner {
  ownerType: KycOwnerType
  documentNumber: string
  fullName: string
  socialName?: string
  birthDate: string
  motherName: string
  phoneNumber: string
  email: string
  address: KycAddress
  isPoliticallyExposedPerson?: boolean
}

/** Pessoa jurídica (KYB). documentNumber = CNPJ. */
export interface KycLegalPersonRequest {
  externalUserId: string
  documentNumber: string
  country?: string // ISO-2, default BR
  businessName: string
  tradingName: string
  companyType: KycCompanyType
  contactNumber: string
  businessEmail: string
  businessAddress: KycAddress
  owners: KycOwner[]
  webhookUrl?: string
}

export type KycSessionStatusValue =
  'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ERROR'

// ── KYB: verificação cadastral da empresa ────────────────────────────────────
// A partner-api NÃO compra onboarding de PJ: ela orquestra o KYB em duas pernas
// - o confronto do CNPJ com a Receita Federal (síncrono, o bloco abaixo) e a
// documentoscopia do REPRESENTANTE LEGAL (assíncrona, é ela que leva a sessão a
// APPROVED/REJECTED). Ver partner-api docs/07.

export type KybCheckId =
  'CNPJ_FOUND' | 'CNPJ_ACTIVE' | 'BUSINESS_NAME_MATCH' | 'REPRESENTATIVE_IN_QSA'

/** SKIPPED = a fonte não trouxe o dado para decidir. NÃO é reprovação. */
export type KybCheckStatus = 'PASS' | 'FAIL' | 'SKIPPED'

export interface KybCheck {
  id: KybCheckId
  status: KybCheckStatus
  /** Mensagem em pt-BR, já pronta para exibir. */
  message: string
}

export interface KybCompanyVerification {
  status: 'VERIFIED' | 'REJECTED'
  /** Provider da cadeia que respondeu (opencnpj | bigdatacorp). */
  source: string
  checkedAt: string
  checks: KybCheck[]
  officialName?: string
  taxIdStatus?: string
  rejectionReason?: string | null
}

/** Sessão KYC/KYB sanitizada (resposta do parceiro). */
export interface KycSession {
  sessionId: string
  externalUserId: string
  type: string // 'PF' | 'PJ'
  provider: string
  providerSessionId: string
  providerTransactionId: string | null
  documentType: string
  documentMasked: string
  country: string
  status: KycSessionStatusValue
  webViewUrl: string | null
  rejectionReason: string | null
  /** Só em sessões PJ: resultado da perna EMPRESA. Null no PF. */
  companyVerification?: KybCompanyVerification | null
  /** Só em sessões PJ: CPF mascarado de quem faz a documentoscopia. Null no PF. */
  representativeMasked?: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  lastSyncAt: string | null
}

// ── Consulta de documento (POST /api/v1/users/kyc/lookup) ────────────────────
// Contrato espelhado à mão de partner-api-v1/src/modules/users/kyc/kyc.types.ts.
// Não há pacote compartilhado: uma mudança lá tem que ser refletida aqui.
//
// A consulta é resolvida por uma CADEIA de providers no lado do parceiro
// (CNPJ: OpenCNPJ gratuito e depois BigDataCorp). Todo campo além dos três
// identificadores é opcional e vem AUSENTE quando a fonte não informou - nunca
// string vazia nem `false` inventado. Tratar `undefined` como "não informado",
// que é diferente de "não".

export type KycDocumentType = 'CPF' | 'CNPJ'

export interface DocumentLookupRequest {
  documentType: KycDocumentType
  documentNumber: string
  country?: string // ISO-2, default BR
}

/** Bloco de atividade econômica (CNAE) ou natureza jurídica. */
export interface LookupActivity {
  code?: string
  description?: string
}

export interface LookupCompanyAddress {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

export interface LookupCompanyPhone {
  areaCode?: string
  number?: string
  isFax?: boolean
}

export interface LookupCompanyEmail {
  address: string
  type?: string
}

/**
 * Sócio do quadro societário (QSA).
 *
 * `documentNumber` chega MASCARADO da Receita Federal ("***345856**") - o número
 * completo não é público. Não serve para preencher o CPF exigido no KYB.
 */
export interface LookupCompanyOwner {
  name?: string
  documentNumber?: string
  role?: string
  joinedAt?: string
  personType?: 'NATURAL' | 'LEGAL'
  ageRange?: string
  legalRepresentative?: {
    documentNumber?: string
    name?: string
    role?: string
  }
}

/** Resultado de CPF. `documentNumber` vem mascarado (é PII). */
export interface PersonLookupData {
  documentType: 'CPF'
  documentNumber: string
  country: string
  name?: string
  commonName?: string
  birthDate?: string
  age?: number
  gender?: string
  motherName?: string
  fatherName?: string
  birthCountry?: string
  taxIdCountry?: string
  taxIdStatus?: string // REGULAR | SUSPENSA | TITULAR FALECIDO | ...
  taxIdStatusDate?: string
  taxIdStatusRegistrationDate?: string
  taxIdOrigin?: string
  taxIdFiscalRegion?: string
  hasObitIndication: boolean
  lastUpdateDate?: string
}

/** Resultado de CNPJ. `documentNumber` vem SEM máscara (dado público). */
export interface CompanyLookupData {
  documentType: 'CNPJ'
  documentNumber: string
  country: string
  officialName?: string // razão social
  tradeName?: string // nome fantasia
  foundedDate?: string
  taxIdStatus?: string // ATIVA | BAIXADA | SUSPENSA | INAPTA | NULA
  taxIdStatusDate?: string
  taxIdStatusReason?: string
  isHeadquarter?: boolean
  headquarterState?: string
  companySize?: string // porte
  taxRegime?: string
  isSimplesOptant?: boolean
  isMeiOptant?: boolean
  /** Capital social em CENTAVOS de BRL (inteiro). Dividir por 100 para exibir. */
  shareCapitalCents?: number
  legalNature?: LookupActivity
  mainActivity?: LookupActivity
  secondaryActivities?: LookupActivity[]
  address?: LookupCompanyAddress
  phones?: LookupCompanyPhone[]
  emails?: LookupCompanyEmail[]
  /** QSA. Só vem quando o provider gratuito respondeu; ausente no fallback pago. */
  owners?: LookupCompanyOwner[]
}

export type DocumentLookupData = PersonLookupData | CompanyLookupData

/** Discriminante seguro entre os dois formatos de resultado. */
export function isCompanyLookup(d: DocumentLookupData): d is CompanyLookupData {
  return d.documentType === 'CNPJ'
}

// ── Erro tipado de configuração ausente ─────────────────────────────────────
export const PARTNER_NOT_CONFIGURED = 'PARTNER_NOT_CONFIGURED'
