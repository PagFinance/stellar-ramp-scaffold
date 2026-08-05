// components/partner/kyc/KycNaturalPersonForm.tsx
'use client'
//
// Formulário de onboarding KYC (pessoa física). Monta o KycNaturalPersonRequest
// e dispara via useKyc.submitNaturalPerson.
import React, { useState } from 'react'
import { useToast } from '@/components/toast/ToastProvider'
import {
  TextField,
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
import { personToFormPatch, personBlockingIssue } from '@/lib/partner/kycAutofill'
import { isValidCPF } from '@/lib/partner/kycValidation'
import { maskCpf } from '@/lib/partner/documentMask'
import type { UseKyc } from '@/hooks/useKyc'
import type { KycNaturalPersonRequest, PersonLookupData } from '@/lib/partner/types'

export default function KycNaturalPersonForm({
  kyc,
  walletAddress = '',
}: {
  kyc: UseKyc
  // Endereço da carteira ativa. É a identidade AUTORITATIVA do KYC: o
  // externalUserId da sessão TEM que ser o mesmo valor usado como `sender` no
  // cash-out (a partner-api emite o JWT/registra o usuário por esse endereço).
  // Se divergir, o KYC aprova sob uma chave que o gate de cash-out nunca resolve.
  walletAddress?: string
}) {
  const toast = useToast()

  // Identidade travada na carteira (não editável) - impede a divergência que
  // deixava o KYC aprovado sob um externalUserId diferente do usuário do cash-out.
  const externalUserId = walletAddress.trim()
  const [documentNumber, setDocumentNumber] = useState('')
  const [fullName, setFullName] = useState('')
  const [socialName, setSocialName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [motherName, setMotherName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [pep, setPep] = useState(false)
  const [address, setAddress] = useState<AddressState>(emptyAddress)

  const lookupState = useKycLookup()
  // Impedimento cadastral (óbito / CPF não regular). Barra o envio: a sessão
  // seria rejeitada pelo provider de qualquer forma, e mais tarde.
  const [blocked, setBlocked] = useState<string | null>(null)

  const runLookup = async () => {
    const cpf = documentNumber.replace(/\D/g, '')
    if (!isValidCPF(cpf)) return toast.error('Informe um CPF válido para consultar.')

    setBlocked(null)
    const result = await lookupState.lookup('CPF', cpf)
    if (!result) {
      if (lookupState.error) toast.error(lookupState.error)
      return
    }

    const person = result as PersonLookupData
    const issue = personBlockingIssue(person)
    setBlocked(issue)

    const patch = personToFormPatch(person)
    if (patch.fullName) setFullName(patch.fullName)
    if (patch.birthDate) setBirthDate(patch.birthDate)
    if (patch.motherName) setMotherName(patch.motherName)

    const filled = Object.keys(patch).length
    if (issue) toast.error(issue)
    else if (filled === 0) {
      toast.info('CPF encontrado, mas a Receita não retornou dados para preencher.')
    } else {
      toast.success(`CPF encontrado. ${filled} campo(s) preenchido(s).`)
    }
  }

  const submit = async () => {
    if (!externalUserId)
      return toast.error(
        'Conecte uma carteira para iniciar o KYC (a identidade é vinculada a ela).',
      )
    if (blocked) return toast.error(blocked)
    const cpf = documentNumber.replace(/\D/g, '')
    if (cpf.length < 11) return toast.error('CPF inválido.')
    if (!fullName.trim()) return toast.error('Informe o nome completo.')
    if (!birthDate) return toast.error('Informe a data de nascimento.')
    if (!motherName.trim()) return toast.error('Informe o nome da mãe.')
    if (!email.trim()) return toast.error('Informe o e-mail.')

    const body: KycNaturalPersonRequest = {
      externalUserId: externalUserId.trim(),
      documentNumber: cpf,
      fullName: fullName.trim(),
      ...(socialName.trim() ? { socialName: socialName.trim() } : {}),
      birthDate,
      motherName: motherName.trim(),
      ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
      email: email.trim(),
      isPoliticallyExposedPerson: pep,
      ...(isAddressComplete(address) ? { address: toKycAddress(address) } : {}),
    }

    const id = toast.pending('Enviando dados para verificação…')
    const err = await kyc.submitNaturalPerson(body)
    toast.update(
      id,
      err
        ? { variant: 'error', message: err }
        : { variant: 'success', message: 'Sessão KYC criada.' },
    )
  }

  const disabled = kyc.busy

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void submit()
      }}
      noValidate
    >
      <FormSection
        index={1}
        title="Identificação"
        note="A consulta preenche nome, nascimento e nome da mãe a partir da Receita Federal."
      >
        <DocumentLookupField
          label="CPF"
          value={documentNumber}
          onChange={(v) => {
            setDocumentNumber(v)
            if (blocked) setBlocked(null)
          }}
          onLookup={() => void runLookup()}
          placeholder="000.000.000-00"
          mask={maskCpf}
          inputMode="numeric"
          disabled={disabled}
          busy={lookupState.busy}
        />

        {blocked ? <LookupNotice variant="error">{blocked}</LookupNotice> : null}

        <TextField
          label="Nome completo"
          value={fullName}
          onChange={setFullName}
          required
          disabled={disabled}
        />
        <div className="f-pair">
          <TextField
            label="Data de nascimento"
            value={birthDate}
            onChange={setBirthDate}
            type="date"
            required
            disabled={disabled}
          />
          <TextField
            label="Nome da mãe"
            value={motherName}
            onChange={setMotherName}
            required
            disabled={disabled}
          />
        </div>
        <TextField
          label="Nome social"
          value={socialName}
          onChange={setSocialName}
          disabled={disabled}
          hint="Opcional."
        />
      </FormSection>

      <FormSection index={2} title="Contato">
        <div className="f-pair">
          <TextField
            label="E-mail"
            value={email}
            onChange={setEmail}
            type="email"
            inputMode="email"
            required
            disabled={disabled}
          />
          <TextField
            label="Telefone"
            value={phoneNumber}
            onChange={setPhoneNumber}
            placeholder="+5511999999999"
            inputMode="tel"
            disabled={disabled}
          />
        </div>
      </FormSection>

      <FormSection index={3} title="Endereço" note="Opcional. Preencha todos os campos ou nenhum.">
        <AddressFields
          value={address}
          onChange={(p) => setAddress((a) => ({ ...a, ...p }))}
          disabled={disabled}
          legend="Endereço residencial"
        />
        <label className="pf-check">
          <input
            type="checkbox"
            checked={pep}
            onChange={(e) => setPep(e.target.checked)}
            disabled={disabled}
          />
          Pessoa politicamente exposta (PEP)
        </label>
      </FormSection>

      <div className="kyc-actions">
        <button
          type="submit"
          disabled={disabled || !externalUserId || Boolean(blocked)}
          className="btn btn-primary"
        >
          {kyc.busy ? 'Enviando…' : 'Enviar KYC'}
        </button>
        <p className="hint">
          {externalUserId
            ? 'Os dados vão para o provider de verificação via Partner API.'
            : 'Conecte uma carteira para enviar - a identidade da verificação é vinculada a ela.'}
        </p>
      </div>
    </form>
  )
}
