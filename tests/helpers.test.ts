import { describe, it, expect } from 'vitest'
import { shortenAddress } from '@/lib/helpers/shortenAddress'
import { toHexString } from '@/lib/helpers/toHexString'
import {
  calcAmountBigInt,
  calcAmountNumber,
  formatNumber,
  safeDivide,
} from '@/lib/helpers/numerical'

describe('shortenAddress', () => {
  it('handles empty/null', () => {
    expect(shortenAddress()).toBe('')
    expect(shortenAddress(null)).toBe('')
  })
  it('returns short strings as-is', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234')
  })
  it('shortens long addresses', () => {
    expect(shortenAddress('0x1234567890abcdef', 4)).toBe('0x12...cdef')
  })
})

describe('toHexString', () => {
  it('encodes utf8 to hex', () => {
    expect(toHexString('abc')).toBe('616263')
  })
})

describe('numerical', () => {
  it('calcAmountBigInt truncates/pads fraction to decimals', () => {
    expect(calcAmountBigInt('1.23', 6)).toBe(1_230_000n)
    expect(calcAmountBigInt('1.2345678', 6)).toBe(1_234_567n) // trunca
    expect(calcAmountBigInt('5', 0)).toBe(5n)
  })
  it('calcAmountNumber floors to integer units', () => {
    expect(calcAmountNumber(1.5, 2)).toBe(150)
  })
  it('formatNumber groups thousands', () => {
    expect(formatNumber(1234.5)).toBe('1,234.50')
    expect(formatNumber('abc')).toBe('0')
  })
  it('safeDivide throws on division by zero', () => {
    expect(() => safeDivide(1, 0)).toThrow()
    expect(safeDivide(10, 2)).toBe(5)
  })
})
