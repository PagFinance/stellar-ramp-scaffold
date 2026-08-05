import { describe, it, expect } from 'vitest'
import { maskCpf, maskCnpj, maskCep, maskDocument } from '@/lib/partner/documentMask'

describe('maskCpf', () => {
  it('formata progressivamente enquanto digita', () => {
    expect(maskCpf('1')).toBe('1')
    expect(maskCpf('123')).toBe('123')
    expect(maskCpf('1234')).toBe('123.4')
    expect(maskCpf('1234567')).toBe('123.456.7')
    expect(maskCpf('12345678901')).toBe('123.456.789-01')
  })

  it('ignora o que não for dígito e corta o excesso', () => {
    expect(maskCpf('abc123def456')).toBe('123.456')
    expect(maskCpf('123456789012345')).toBe('123.456.789-01')
  })

  it('é idempotente (é reaplicada a cada tecla)', () => {
    expect(maskCpf(maskCpf('12345678901'))).toBe('123.456.789-01')
  })
})

describe('maskCnpj', () => {
  it('formata CNPJ numérico progressivamente', () => {
    expect(maskCnpj('11')).toBe('11')
    expect(maskCnpj('11222')).toBe('11.222')
    expect(maskCnpj('11222333')).toBe('11.222.333')
    expect(maskCnpj('112223330001')).toBe('11.222.333/0001')
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })

  // O ponto da mudança: o CNPJ alfanumérico tem LETRAS nos 12 primeiros
  // caracteres (IN RFB nº 2.229/2024).
  it('aceita letras no corpo do CNPJ alfanumérico', () => {
    expect(maskCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
  })

  it('formata o primeiro CNPJ alfanumérico emitido no Brasil', () => {
    expect(maskCnpj('00000000E08G12')).toBe('00.000.000/E08G-12')
  })

  it('normaliza letras para maiúsculas', () => {
    expect(maskCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35')
  })

  it('descarta letra na posição de dígito verificador (DV é numérico)', () => {
    expect(maskCnpj('12ABC34501DEAB')).toBe('12.ABC.345/01DE')
    expect(maskCnpj('12ABC34501DE3X')).toBe('12.ABC.345/01DE-3')
  })

  it('ignora separadores digitados e corta o excesso', () => {
    expect(maskCnpj('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35')
    expect(maskCnpj('11222333000181999')).toBe('11.222.333/0001-81')
  })

  it('é idempotente', () => {
    expect(maskCnpj(maskCnpj('12ABC34501DE35'))).toBe('12.ABC.345/01DE-35')
  })

  it('não descarta caractere ao apagar (permite corrigir o que foi digitado)', () => {
    // Apagar o último caractere da string mascarada tem que render a máscara do
    // valor menor, não travar num separador.
    expect(maskCnpj('12.ABC.345/01DE-3')).toBe('12.ABC.345/01DE-3')
    expect(maskCnpj('12.ABC.345/01DE-')).toBe('12.ABC.345/01DE')
  })
})

describe('maskDocument', () => {
  it('escolhe a máscara pelo tipo', () => {
    expect(maskDocument('CPF', '12345678901')).toBe('123.456.789-01')
    expect(maskDocument('CNPJ', '12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
  })
})

describe('maskCep', () => {
  it('formata 00000-000', () => {
    expect(maskCep('70040912')).toBe('70040-912')
    expect(maskCep('70040')).toBe('70040')
    expect(maskCep('7004')).toBe('7004')
  })

  it('é idempotente', () => {
    expect(maskCep(maskCep('70040912'))).toBe('70040-912')
  })
})
