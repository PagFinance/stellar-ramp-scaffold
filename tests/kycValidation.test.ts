import { describe, it, expect } from 'vitest'
import {
  isValidCPF,
  isValidCNPJ,
  isValidEmail,
  isValidISODate,
  onlyCnpjChars,
} from '@/lib/partner/kycValidation'

describe('isValidCPF', () => {
  it('aceita CPF válido (com e sem máscara)', () => {
    expect(isValidCPF('52998224725')).toBe(true)
    expect(isValidCPF('529.982.247-25')).toBe(true)
  })
  it('rejeita dígitos verificadores errados, tamanho e repetição', () => {
    expect(isValidCPF('52998224724')).toBe(false)
    expect(isValidCPF('11111111111')).toBe(false)
    expect(isValidCPF('123')).toBe(false)
  })
})

describe('isValidCNPJ', () => {
  it('aceita CNPJ válido (com e sem máscara)', () => {
    expect(isValidCNPJ('11222333000181')).toBe(true)
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true)
  })
  it('rejeita dígitos errados, tamanho e repetição', () => {
    expect(isValidCNPJ('11222333000180')).toBe(false)
    expect(isValidCNPJ('00000000000000')).toBe(false)
    expect(isValidCNPJ('123')).toBe(false)
  })

  // CNPJ ALFANUMÉRICO (IN RFB nº 2.229/2024, transição a partir de julho/2026):
  // 12 caracteres alfanuméricos + 2 DV numéricos. Valor de cada caractere no
  // módulo 11 = ASCII - 48, então '0'..'9' seguem 0..9 e 'A'..'Z' viram 17..42.
  describe('formato alfanumérico', () => {
    // O PRIMEIRO CNPJ alfanumérico efetivamente emitido no Brasil. Vetor real,
    // vale mais que qualquer caso sintético.
    it('aceita o primeiro CNPJ alfanumérico emitido no Brasil', () => {
      expect(isValidCNPJ('00.000.000/E08G-12')).toBe(true)
      expect(isValidCNPJ('00000000E08G12')).toBe(true)
    })

    it('aceita CNPJ alfanumérico válido, com e sem máscara', () => {
      expect(isValidCNPJ('12ABC34501DE35')).toBe(true)
      expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true)
      expect(isValidCNPJ('A1B2C3D4E5F668')).toBe(true)
    })

    it('aceita minúsculas (normaliza para maiúsculas)', () => {
      expect(isValidCNPJ('12abc34501de35')).toBe(true)
    })

    it('rejeita DV errado no formato alfanumérico', () => {
      expect(isValidCNPJ('12ABC34501DE36')).toBe(false)
    })

    it('rejeita letra na posição de dígito verificador', () => {
      // Os dois últimos caracteres são sempre numéricos.
      expect(isValidCNPJ('12ABC34501DE3A')).toBe(false)
    })

    it('mantém compatibilidade retroativa: CNPJ numérico calcula igual', () => {
      // Estes existem de verdade e continuam válidos após a mudança.
      expect(isValidCNPJ('00000000000191')).toBe(true) // Banco do Brasil
      expect(isValidCNPJ('33000167000101')).toBe(true) // Petrobras
    })

    it('rejeita repetição trivial também no corpo alfanumérico', () => {
      expect(isValidCNPJ('AAAAAAAAAAAA00')).toBe(false)
    })
  })
})

describe('onlyCnpjChars', () => {
  it('preserva letras e descarta a máscara', () => {
    expect(onlyCnpjChars('12.ABC.345/01DE-35')).toBe('12ABC34501DE35')
  })

  it('normaliza para maiúsculas', () => {
    expect(onlyCnpjChars('12abc34501de35')).toBe('12ABC34501DE35')
  })

  // Regressão do bug que motivou esta função: `replace(/\D/g, '')` em CNPJ
  // alfanumérico apaga as letras e devolve um documento mutilado.
  it('NÃO se comporta como onlyDigits', () => {
    expect(onlyCnpjChars('12ABC34501DE35')).not.toBe('12345013'.slice(0, 8))
    expect(onlyCnpjChars('12ABC34501DE35')).toHaveLength(14)
  })

  it('corta em 14 caracteres', () => {
    expect(onlyCnpjChars('12ABC34501DE35999')).toBe('12ABC34501DE35')
  })
})

describe('isValidEmail / isValidISODate', () => {
  it('email', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('sem-arroba')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })
  it('data ISO', () => {
    expect(isValidISODate('1990-05-20')).toBe(true)
    expect(isValidISODate('20/05/1990')).toBe(false)
    expect(isValidISODate('not-a-date')).toBe(false)
  })
})
