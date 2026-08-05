// lib/partner/kycValidation.ts
//
// Validação de FORMATO para os inputs de KYC (a validação autoritativa de
// identidade é feita pela partner-api). Evita enviar lixo óbvio e dá erro
// acionável ao usuário. Sem dependências externas.

export function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '')
}

function allSameDigit(v: string): boolean {
  return /^(\d)\1+$/.test(v)
}

/** Valida CPF (11 dígitos + dígitos verificadores). */
export function isValidCPF(input: string): boolean {
  const cpf = onlyDigits(input)
  if (cpf.length !== 11 || allSameDigit(cpf)) return false

  const digit = (sliceLen: number): number => {
    let sum = 0
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(cpf[i]) * (sliceLen + 1 - i)
    }
    const r = (sum * 10) % 11
    return r === 10 || r === 11 ? 0 : r
  }

  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

/**
 * Normaliza um CNPJ para os 14 caracteres significativos, em MAIÚSCULAS.
 *
 * NÃO use `onlyDigits` em CNPJ: desde a IN RFB nº 2.229/2024 (transição a partir
 * de julho/2026) os 12 primeiros caracteres são ALFANUMÉRICOS - só os 2 dígitos
 * verificadores continuam numéricos. Tirar os não-dígitos apagaria as letras e
 * transformaria um CNPJ válido em lixo.
 */
export function onlyCnpjChars(v: string): string {
  return (v ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14)
}

function allSameChar(v: string): boolean {
  return /^(.)\1+$/.test(v)
}

/**
 * Valida CNPJ, numérico ou alfanumérico (12 caracteres + 2 DV numéricos).
 *
 * Módulo 11 com os mesmos pesos de sempre; o que muda é o valor de cada
 * caractere: `código ASCII - 48`. Assim '0'..'9' seguem valendo 0..9 (então todo
 * CNPJ numérico antigo continua validando igual) e 'A'..'Z' valem 17..42.
 *
 * Ref.: IN RFB nº 2.229/2024 e a nota técnica de cálculo do DV do Serpro.
 */
export function isValidCNPJ(input: string): boolean {
  const cnpj = onlyCnpjChars(input)
  if (cnpj.length !== 14) return false
  // Os DV são sempre numéricos, inclusive no formato alfanumérico.
  if (!/^\d{2}$/.test(cnpj.slice(12))) return false
  // Rejeita repetição trivial ("00000000000000", "AAAAAAAAAAAA00"...).
  if (allSameChar(cnpj) || allSameChar(cnpj.slice(0, 12))) return false

  /** Valor do caractere no cálculo: ASCII - 48. '0'->0, 'A'->17, 'Z'->42. */
  const charValue = (c: string): number => c.charCodeAt(0) - 48

  const calc = (len: number): number => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < len; i++) sum += charValue(cnpj[i]!) * weights[i]!
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }

  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13])
}

/** Valida um e-mail de forma pragmática (formato, não deliverability). */
export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((input ?? '').trim())
}

/** Valida uma data no formato ISO (YYYY-MM-DD) e que seja uma data real. */
export function isValidISODate(input: string): boolean {
  const s = (input ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false
  return !Number.isNaN(Date.parse(s))
}
