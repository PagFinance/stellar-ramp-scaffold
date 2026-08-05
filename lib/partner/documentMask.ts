// lib/partner/documentMask.ts
//
// Máscaras de digitação para CPF e CNPJ. Funções puras: recebem o que está no
// input e devolvem o texto formatado, aplicáveis a cada tecla.
//
// A máscara é PROGRESSIVA - formata só o que já foi digitado, sem exibir
// separador à frente do cursor. Também é idempotente: aplicar de novo sobre o
// resultado não muda nada, o que é o que permite chamá-la a cada onChange.

import { onlyDigits, onlyCnpjChars } from '@/lib/partner/kycValidation'

/** CPF: 000.000.000-00 (só dígitos). */
export function maskCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * CNPJ: AA.AAA.AAA/AAAA-00.
 *
 * Os 12 primeiros caracteres aceitam LETRAS (CNPJ alfanumérico, IN RFB nº
 * 2.229/2024); os 2 dígitos verificadores continuam numéricos, então uma letra
 * digitada na posição de DV é descartada em vez de entrar na máscara.
 */
export function maskCnpj(input: string): string {
  const raw = onlyCnpjChars(input)
  // Corpo alfanumérico + DV estritamente numérico.
  const body = raw.slice(0, 12)
  const dv = raw.slice(12).replace(/\D/g, '')
  const c = body + dv

  if (c.length <= 2) return c
  if (c.length <= 5) return `${c.slice(0, 2)}.${c.slice(2)}`
  if (c.length <= 8) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`
  if (c.length <= 12) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8)}`
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
}

/** Máscara por tipo de documento, para os campos compartilhados. */
export function maskDocument(documentType: 'CPF' | 'CNPJ', input: string): string {
  return documentType === 'CNPJ' ? maskCnpj(input) : maskCpf(input)
}

// Telefone NÃO tem máscara aqui de propósito: o formulário submete o valor cru
// (`phoneNumber`/`contactNumber` vão direto no body), então formatar na tela
// mandaria "+55 (61) 3493-9002" para a Partner API. CPF, CNPJ e CEP podem ser
// mascarados porque são sanitizados antes do submit.

/** CEP: 00000-000. */
export function maskCep(input: string): string {
  const d = onlyDigits(input).slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}
