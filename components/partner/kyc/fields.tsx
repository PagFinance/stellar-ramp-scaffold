// components/partner/kyc/fields.tsx
'use client'
//
// Campos reutilizáveis dos formulários de KYC/KYB (TextField, SelectField,
// AddressFields). Seguem os estilos de components/partner/formStyles.
import React, { useId } from 'react'
import { maskCep } from '@/lib/partner/documentMask'

export interface AddressState {
  postalCode: string
  street: string
  number: string
  addressComplement: string
  neighborhood: string
  city: string
  state: string
}

export const emptyAddress: AddressState = {
  postalCode: '',
  street: '',
  number: '',
  addressComplement: '',
  neighborhood: '',
  city: '',
  state: '',
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  disabled,
  readOnly,
  hint,
  type = 'text',
  mask,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  // Somente-leitura: exibe o valor mas impede edição (o valor ainda é submetido).
  // Diferente de `disabled`, que sinaliza "formulário ocupado".
  readOnly?: boolean
  // Texto auxiliar curto abaixo do campo (ex.: explicar por que está travado).
  hint?: string
  type?: string
  // Formatação aplicada a cada tecla (ver lib/partner/documentMask.ts). Precisa
  // ser idempotente - é reaplicada sobre o próprio resultado.
  mask?: (v: string) => string
  inputMode?: 'text' | 'numeric' | 'tel' | 'email'
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="pf-label">
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={id}
        className="pf-input"
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(mask ? mask(e.target.value) : e.target.value)}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-required={required || undefined}
      />
      {hint ? (
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Campo de documento com botão de consulta ao lado.
 *
 * Usado no CPF (PF) e no CNPJ (PJ) para disparar a consulta cadastral que
 * preenche o resto do formulário. O botão é `type="button"` de propósito: dentro
 * de um <form>, o default `submit` enviaria o formulário em vez de consultar.
 */
export function DocumentLookupField({
  label,
  value,
  onChange,
  onLookup,
  placeholder,
  disabled,
  busy,
  hint,
  mask,
  inputMode,
  buttonLabel = 'Buscar dados',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onLookup: () => void
  placeholder?: string
  disabled?: boolean
  busy?: boolean
  hint?: string
  mask?: (v: string) => string
  inputMode?: 'text' | 'numeric' | 'tel' | 'email'
  buttonLabel?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="pf-label">
        {label} *
      </label>
      <div className="doc-field">
        <input
          id={id}
          className="pf-input"
          type="text"
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(mask ? mask(e.target.value) : e.target.value)}
          onKeyDown={(e) => {
            // Enter no campo consulta em vez de submeter o formulário incompleto.
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!disabled && !busy) onLookup()
            }
          }}
          disabled={disabled}
          required
          aria-required
        />
        <button
          type="button"
          className="btn btn-outline"
          onClick={onLookup}
          disabled={disabled || busy || !value.trim()}
        >
          {busy ? 'Buscando…' : buttonLabel}
        </button>
      </div>
      {hint ? (
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Bloco de aviso/resumo abaixo de um campo de consulta. */
export function LookupNotice({
  variant,
  children,
}: {
  variant: 'info' | 'warn' | 'error'
  children: React.ReactNode
}) {
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`notice notice-${variant}`}>
      {children}
    </div>
  )
}

/**
 * Seção numerada do formulário.
 *
 * A numeração não é enfeite: reflete a ordem que a própria Partner API exige
 * (identificação -> dados -> sócios -> envio). É o que quebra a parede de
 * campos em blocos legíveis.
 */
export function FormSection({
  index,
  title,
  note,
  children,
}: {
  index: number
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="sec">
      <span className="sec-num" aria-hidden>
        {index}
      </span>
      <header className="sec-head">
        <h2 className="sec-title">{title}</h2>
        {note ? <p className="sec-note">{note}</p> : null}
      </header>
      <div className="sec-body">{children}</div>
    </section>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  required?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="pf-label">
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        id={id}
        className="pf-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AddressFields({
  value,
  onChange,
  disabled,
  legend = 'Endereço',
}: {
  value: AddressState
  onChange: (patch: Partial<AddressState>) => void
  disabled?: boolean
  legend?: string
}) {
  return (
    <fieldset
      style={{
        display: 'grid',
        gap: 'var(--space-4)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-4)',
        margin: 0,
      }}
    >
      <legend className="rail-label" style={{ padding: '0 6px', margin: 0 }}>
        {legend}
      </legend>
      <div className="f-pair">
        <TextField
          label="CEP"
          value={value.postalCode}
          onChange={(v) => onChange({ postalCode: v })}
          placeholder="01311-000"
          mask={maskCep}
          inputMode="numeric"
          required
          disabled={disabled}
        />
        <TextField
          label="UF"
          value={value.state}
          onChange={(v) => onChange({ state: v.toUpperCase().slice(0, 2) })}
          placeholder="SP"
          required
          disabled={disabled}
        />
      </div>
      <TextField
        label="Rua"
        value={value.street}
        onChange={(v) => onChange({ street: v })}
        required
        disabled={disabled}
      />
      <div className="f-pair">
        <TextField
          label="Número"
          value={value.number}
          onChange={(v) => onChange({ number: v })}
          required
          disabled={disabled}
        />
        <TextField
          label="Complemento"
          value={value.addressComplement}
          onChange={(v) => onChange({ addressComplement: v })}
          disabled={disabled}
        />
      </div>
      <div className="f-pair">
        <TextField
          label="Bairro"
          value={value.neighborhood}
          onChange={(v) => onChange({ neighborhood: v })}
          required
          disabled={disabled}
        />
        <TextField
          label="Cidade"
          value={value.city}
          onChange={(v) => onChange({ city: v })}
          required
          disabled={disabled}
        />
      </div>
    </fieldset>
  )
}

/** Converte AddressState em KycAddress (omitindo complemento vazio). */
export function toKycAddress(a: AddressState) {
  return {
    postalCode: a.postalCode.replace(/\D/g, ''),
    street: a.street.trim(),
    number: a.number.trim(),
    ...(a.addressComplement.trim() ? { addressComplement: a.addressComplement.trim() } : {}),
    neighborhood: a.neighborhood.trim(),
    city: a.city.trim(),
    state: a.state.trim().toUpperCase(),
  }
}

/** true se todos os campos obrigatórios de endereço estão preenchidos. */
export function isAddressComplete(a: AddressState) {
  return Boolean(a.postalCode && a.street && a.number && a.neighborhood && a.city && a.state)
}
