// components/partner/kyc/KycLegalPersonForm.tsx
'use client'
//
// Formulário de onboarding KYB (pessoa jurídica), com lista de sócios/representantes.
import React, { useState } from 'react'
import { useToast } from '@/components/toast/ToastProvider'
import {
  TextField,
  SelectField,
  AddressFields,
  DocumentLookupField,
  LookupNotice,
  FormSection,
  emptyAddress,
  toKycAddress,
  isAddressComplete,
  type AddressState,
} from './fields'
import { useKycLookup } from '@/hooks/useKycLookup'
import { companyToFormPatch, companyBlockingIssue, ownersFromQsa } from '@/lib/partner/kycAutofill'
import { isValidCNPJ, onlyCnpjChars, onlyDigits } from '@/lib/partner/kycValidation'
import { maskCnpj, maskCpf } from '@/lib/partner/documentMask'
import KybCompanyChecks from './KybCompanyChecks'
import type { UseKyc } from '@/hooks/useKyc'
import type {
  KycLegalPersonRequest,
  KycOwner,
  KycOwnerType,
  KycCompanyType,
  CompanyLookupData,
} from '@/lib/partner/types'

const COMPANY_TYPES: { value: KycCompanyType; label: string }[] = [
  { value: 'LTDA', label: 'LTDA' },
  { value: 'MEI', label: 'MEI' },
  { value: 'EI', label: 'EI' },
  { value: 'EIRELI', label: 'EIRELI' },
  { value: 'SA', label: 'S.A.' },
  { value: 'SLU', label: 'SLU' },
]

const OWNER_TYPE_LABEL: Record<KycOwnerType, string> = {
  PARTNER: 'Sócio',
  LEGAL_REPRESENTATIVE: 'Representante legal',
  BOTH: 'Sócio e representante',
}

const OWNER_TYPES: { value: KycOwnerType; label: string }[] = [
  { value: 'PARTNER', label: 'Sócio' },
  { value: 'LEGAL_REPRESENTATIVE', label: 'Representante legal' },
  { value: 'BOTH', label: 'Sócio e representante' },
]

interface OwnerState {
  /** Chave estável de lista (não usar índice - a lista é mutável: add/remove). */
  uid: string
  ownerType: KycOwnerType
  documentNumber: string
  fullName: string
  socialName: string
  birthDate: string
  motherName: string
  phoneNumber: string
  email: string
  address: AddressState
  pep: boolean
  /**
   * CPF parcial vindo do QSA da Receita ("***345856**"). Só para exibir: o
   * número completo não é público, então o campo de CPF continua vazio e o
   * usuário precisa preenchê-lo.
   */
  maskedDocument?: string
}

function newOwner(): OwnerState {
  return {
    uid: crypto.randomUUID(),
    ownerType: 'PARTNER',
    documentNumber: '',
    fullName: '',
    socialName: '',
    birthDate: '',
    motherName: '',
    phoneNumber: '',
    email: '',
    address: { ...emptyAddress },
    pep: false,
  }
}

export default function KycLegalPersonForm({
  kyc,
  walletAddress = '',
}: {
  kyc: UseKyc
  // Endereço da carteira ativa. Identidade AUTORITATIVA do KYB: o externalUserId
  // da sessão TEM que ser o mesmo valor usado como `sender` no cash-out, senão a
  // aprovação fica sob uma chave que o gate de cash-out nunca resolve.
  walletAddress?: string
}) {
  const toast = useToast()

  // Identidade travada na carteira (não editável) - evita divergência com o cash-out.
  const externalUserId = walletAddress.trim()
  const [documentNumber, setDocumentNumber] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [companyType, setCompanyType] = useState<KycCompanyType>('LTDA')
  const [contactNumber, setContactNumber] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')
  const [businessAddress, setBusinessAddress] = useState<AddressState>({ ...emptyAddress })
  const [owners, setOwners] = useState<OwnerState[]>(() => [newOwner()])
  // Um sócio aberto por vez: com 5+ sócios vindos do QSA, tudo expandido é
  // exatamente a parede de campos que esta tela tinha. Começa com o primeiro
  // aberto, porque no estado inicial há um só e ele precisa ser preenchido.
  const [openOwner, setOpenOwner] = useState<string | null>(null)
  const firstOwnerUid = owners[0]?.uid ?? null
  const expandedOwner = openOwner ?? (owners.length === 1 ? firstOwnerUid : null)

  // Quem assina pela empresa é quem a partner-api coloca na documentoscopia.
  // Sem representante marcado não há ninguém para verificar, e o envio é
  // recusado (400 KYB_REPRESENTATIVE_MISSING) - então o formulário cobra antes.
  const hasRepresentative = owners.some(
    (o) => o.ownerType === 'LEGAL_REPRESENTATIVE' || o.ownerType === 'BOTH',
  )

  const lookupState = useKycLookup()
  const [blocked, setBlocked] = useState<string | null>(null)
  const [qsaNotice, setQsaNotice] = useState<string | null>(null)

  const disabled = kyc.busy

  const runLookup = async () => {
    // onlyCnpjChars, nunca replace(/\D/g): o CNPJ alfanumérico tem LETRAS nos 12
    // primeiros caracteres - tirar os não-dígitos destruiria o documento.
    const cnpj = onlyCnpjChars(documentNumber)
    if (!isValidCNPJ(cnpj)) return toast.error('Informe um CNPJ válido para consultar.')

    setBlocked(null)
    setQsaNotice(null)

    const result = await lookupState.lookup('CNPJ', cnpj)
    if (!result) {
      if (lookupState.error) toast.error(lookupState.error)
      return
    }

    const company = result as CompanyLookupData
    const issue = companyBlockingIssue(company)
    setBlocked(issue)

    const patch = companyToFormPatch(company)
    if (patch.businessName) setBusinessName(patch.businessName)
    if (patch.tradingName) setTradingName(patch.tradingName)
    if (patch.businessEmail) setBusinessEmail(patch.businessEmail)
    if (patch.contactNumber) setContactNumber(patch.contactNumber)
    if (patch.companyType) setCompanyType(patch.companyType)
    if (patch.businessAddress) {
      setBusinessAddress((a) => ({ ...a, ...patch.businessAddress }))
    }

    // QSA: cria um bloco por sócio com nome e papel. O CPF fica em branco de
    // propósito - a Receita só publica o número parcial.
    const prefills = ownersFromQsa(company.owners)
    if (prefills.length > 0) {
      setOwners(
        prefills.map((p) => ({
          ...newOwner(),
          ownerType: p.ownerType,
          fullName: p.fullName,
          ...(p.maskedDocument ? { maskedDocument: p.maskedDocument } : {}),
        })),
      )
      setOpenOwner(null)
      setQsaNotice(
        `${prefills.length} sócio(s) importado(s) do quadro societário. A Receita Federal publica ` +
          'apenas o CPF parcial, então informe o CPF completo, a data de nascimento, o nome da mãe ' +
          'e os contatos de cada um.',
      )
    }

    if (issue) toast.error(issue)
    else toast.success('CNPJ encontrado. Dados da empresa preenchidos.')
  }

  const patchOwner = (i: number, patch: Partial<OwnerState>) =>
    setOwners((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))

  const patchOwnerAddress = (i: number, patch: Partial<AddressState>) =>
    setOwners((prev) =>
      prev.map((o, idx) => (idx === i ? { ...o, address: { ...o.address, ...patch } } : o)),
    )

  const submit = async () => {
    if (!externalUserId)
      return toast.error(
        'Conecte uma carteira para iniciar o KYB (a identidade é vinculada a ela).',
      )
    if (blocked) return toast.error(blocked)
    const cnpj = onlyCnpjChars(documentNumber)
    if (!isValidCNPJ(cnpj)) return toast.error('CNPJ inválido.')
    if (!businessName.trim()) return toast.error('Informe a razão social.')
    if (!tradingName.trim()) return toast.error('Informe o nome fantasia.')
    if (!contactNumber.trim()) return toast.error('Informe o telefone de contato.')
    if (!businessEmail.trim()) return toast.error('Informe o e-mail comercial.')
    if (!isAddressComplete(businessAddress)) return toast.error('Complete o endereço da empresa.')

    const mappedOwners: KycOwner[] = []
    for (let i = 0; i < owners.length; i++) {
      const o = owners[i]!
      const ownerCpf = onlyDigits(o.documentNumber)
      const n = i + 1
      if (ownerCpf.length < 11) return toast.error(`Sócio ${n}: CPF inválido.`)
      if (!o.fullName.trim()) return toast.error(`Sócio ${n}: informe o nome.`)
      if (!o.birthDate) return toast.error(`Sócio ${n}: informe a data de nascimento.`)
      if (!o.motherName.trim()) return toast.error(`Sócio ${n}: informe o nome da mãe.`)
      if (!o.phoneNumber.trim()) return toast.error(`Sócio ${n}: informe o telefone.`)
      if (!o.email.trim()) return toast.error(`Sócio ${n}: informe o e-mail.`)
      if (!isAddressComplete(o.address)) return toast.error(`Sócio ${n}: complete o endereço.`)

      mappedOwners.push({
        ownerType: o.ownerType,
        documentNumber: ownerCpf,
        fullName: o.fullName.trim(),
        ...(o.socialName.trim() ? { socialName: o.socialName.trim() } : {}),
        birthDate: o.birthDate,
        motherName: o.motherName.trim(),
        phoneNumber: o.phoneNumber.trim(),
        email: o.email.trim(),
        address: toKycAddress(o.address),
        isPoliticallyExposedPerson: o.pep,
      })
    }

    if (!mappedOwners.some((o) => o.ownerType === 'LEGAL_REPRESENTATIVE' || o.ownerType === 'BOTH'))
      return toast.error(
        'Marque ao menos um sócio como representante legal: é a identidade dele que será verificada.',
      )

    const body: KycLegalPersonRequest = {
      externalUserId: externalUserId.trim(),
      documentNumber: cnpj,
      businessName: businessName.trim(),
      tradingName: tradingName.trim(),
      companyType,
      contactNumber: contactNumber.trim(),
      businessEmail: businessEmail.trim(),
      businessAddress: toKycAddress(businessAddress),
      owners: mappedOwners,
    }

    const id = toast.pending('Enviando dados da empresa…')
    const err = await kyc.submitLegalPerson(body)
    toast.update(
      id,
      err
        ? { variant: 'error', message: err }
        : { variant: 'success', message: 'Sessão KYB criada.' },
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void submit()
      }}
      noValidate
    >
      {/*
        O KYB tem DUAS pernas, e dizer isso antes do formulário evita a surpresa
        de a empresa ser reprovada no envio (perna 1) ou de aparecer um link de
        selfie no fim (perna 2). Ver partner-api docs/07.
      */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <LookupNotice variant="info">
          <strong>Como funciona.</strong> A empresa é conferida na Receita Federal (CNPJ ativo,
          razão social e quadro societário) e, em seguida, o <strong>representante legal</strong>{' '}
          faz a verificação de documento e selfie. Consulte o CNPJ abaixo para preencher tudo com os
          dados oficiais e passar de primeira.
        </LookupNotice>
      </div>

      {/*
        Reprovação da empresa (422): a sessão nem chega a ser criada, então este
        bloco - e não o trilho lateral - é onde o resultado aparece.
      */}
      {kyc.companyRejection ? (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <LookupNotice variant="error">
            <strong>Empresa reprovada na verificação cadastral.</strong>
            <div style={{ marginTop: 10 }}>
              <KybCompanyChecks verification={kyc.companyRejection} />
            </div>
          </LookupNotice>
        </div>
      ) : null}

      <FormSection
        index={1}
        title="Empresa"
        note="A consulta preenche razão social, contatos, endereço e o quadro societário."
      >
        <DocumentLookupField
          label="CNPJ"
          value={documentNumber}
          onChange={(v) => {
            setDocumentNumber(v)
            if (blocked) setBlocked(null)
          }}
          onLookup={() => void runLookup()}
          placeholder="00.000.000/0000-00"
          mask={maskCnpj}
          disabled={disabled}
          busy={lookupState.busy}
          hint="Aceita CNPJ alfanumérico."
        />

        {blocked ? <LookupNotice variant="error">{blocked}</LookupNotice> : null}

        <div className="f-pair">
          <TextField
            label="Razão social"
            value={businessName}
            onChange={setBusinessName}
            required
            disabled={disabled}
          />
          <TextField
            label="Nome fantasia"
            value={tradingName}
            onChange={setTradingName}
            required
            disabled={disabled}
          />
        </div>
        <SelectField
          label="Tipo de empresa"
          value={companyType}
          onChange={(v) => setCompanyType(v as KycCompanyType)}
          options={COMPANY_TYPES}
          required
          disabled={disabled}
        />
      </FormSection>

      <FormSection index={2} title="Contato e endereço">
        <div className="f-pair">
          <TextField
            label="E-mail comercial"
            value={businessEmail}
            onChange={setBusinessEmail}
            type="email"
            inputMode="email"
            required
            disabled={disabled}
          />
          <TextField
            label="Telefone de contato"
            value={contactNumber}
            onChange={setContactNumber}
            placeholder="+5511999999999"
            inputMode="tel"
            required
            disabled={disabled}
          />
        </div>
        <AddressFields
          value={businessAddress}
          onChange={(p) => setBusinessAddress((a) => ({ ...a, ...p }))}
          disabled={disabled}
          legend="Endereço da empresa"
        />
      </FormSection>

      <FormSection
        index={3}
        title="Quadro societário"
        note={`${owners.length} sócio(s). Clique para abrir e completar os dados de cada um.`}
      >
        {qsaNotice ? <LookupNotice variant="warn">{qsaNotice}</LookupNotice> : null}

        {/* Cobrado aqui, e não só no envio: é a diferença entre descobrir a
            exigência antes de preencher os sócios ou depois. */}
        {!hasRepresentative ? (
          <LookupNotice variant="warn">
            Marque quem assina pela empresa com o papel <strong>Representante legal</strong> (ou{' '}
            <strong>Sócio e representante</strong>). É essa pessoa que fará a verificação de
            documento e selfie.
          </LookupNotice>
        ) : null}

        <div>
          {owners.map((o, i) => {
            const open = expandedOwner === o.uid
            return (
              <div key={o.uid} className="owner" data-open={open}>
                <button
                  type="button"
                  className="owner-head"
                  aria-expanded={open}
                  onClick={() => setOpenOwner(open ? null : o.uid)}
                >
                  <span className="owner-idx" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="owner-name">
                    {o.fullName.trim() || `Sócio ${i + 1}`}
                    <span className="role">{OWNER_TYPE_LABEL[o.ownerType]}</span>
                  </span>
                  <span className="owner-chev" aria-hidden>
                    ▶
                  </span>
                </button>

                {open ? (
                  <div className="owner-body">
                    <div className="f-pair">
                      <SelectField
                        label="Papel"
                        value={o.ownerType}
                        onChange={(v) => patchOwner(i, { ownerType: v as KycOwnerType })}
                        options={OWNER_TYPES}
                        required
                        disabled={disabled}
                      />
                      <TextField
                        label="CPF"
                        value={o.documentNumber}
                        onChange={(v) => patchOwner(i, { documentNumber: v })}
                        placeholder="000.000.000-00"
                        mask={maskCpf}
                        inputMode="numeric"
                        required
                        disabled={disabled}
                        hint={
                          o.maskedDocument
                            ? `Receita Federal: ${o.maskedDocument} (parcial). Informe o completo.`
                            : undefined
                        }
                      />
                    </div>
                    <TextField
                      label="Nome completo"
                      value={o.fullName}
                      onChange={(v) => patchOwner(i, { fullName: v })}
                      required
                      disabled={disabled}
                    />
                    <div className="f-pair">
                      <TextField
                        label="Data de nascimento"
                        value={o.birthDate}
                        onChange={(v) => patchOwner(i, { birthDate: v })}
                        type="date"
                        required
                        disabled={disabled}
                      />
                      <TextField
                        label="Nome da mãe"
                        value={o.motherName}
                        onChange={(v) => patchOwner(i, { motherName: v })}
                        required
                        disabled={disabled}
                      />
                    </div>
                    <div className="f-pair">
                      <TextField
                        label="E-mail"
                        value={o.email}
                        onChange={(v) => patchOwner(i, { email: v })}
                        type="email"
                        inputMode="email"
                        required
                        disabled={disabled}
                      />
                      <TextField
                        label="Telefone"
                        value={o.phoneNumber}
                        onChange={(v) => patchOwner(i, { phoneNumber: v })}
                        placeholder="+5511999999999"
                        inputMode="tel"
                        required
                        disabled={disabled}
                      />
                    </div>
                    <AddressFields
                      value={o.address}
                      onChange={(p) => patchOwnerAddress(i, p)}
                      disabled={disabled}
                      legend="Endereço do sócio"
                    />
                    <label className="pf-check">
                      <input
                        type="checkbox"
                        checked={o.pep}
                        onChange={(e) => patchOwner(i, { pep: e.target.checked })}
                        disabled={disabled}
                      />
                      Pessoa politicamente exposta (PEP)
                    </label>
                    {owners.length > 1 ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setOwners((prev) => prev.filter((_, idx) => idx !== i))
                            setOpenOwner(null)
                          }}
                          disabled={disabled}
                          className="btn btn-outline btn-sm"
                        >
                          Remover sócio
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              const o = newOwner()
              setOwners((prev) => [...prev, o])
              setOpenOwner(o.uid)
            }}
            disabled={disabled}
            className="btn btn-outline btn-sm"
          >
            + Adicionar sócio
          </button>
        </div>
      </FormSection>

      <div className="kyc-actions">
        <button
          type="submit"
          disabled={disabled || !externalUserId || Boolean(blocked) || !hasRepresentative}
          className="btn btn-primary"
        >
          {kyc.busy ? 'Enviando…' : 'Enviar KYB'}
        </button>
        <p className="hint">
          {!externalUserId
            ? 'Conecte uma carteira para enviar - a identidade da verificação é vinculada a ela.'
            : !hasRepresentative
              ? 'Falta marcar o representante legal no quadro societário.'
              : 'A empresa é conferida na Receita Federal e o representante legal recebe o link da verificação.'}
        </p>
      </div>
    </form>
  )
}
