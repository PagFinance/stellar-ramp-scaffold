import { describe, it, expect } from 'vitest'
import {
  hasDisconnect,
  hasSignMessage,
  hasSubmitTransfer,
  hasSubmitTransferInterpret,
  type WalletSlice,
} from '@/lib/types/WalletSlice'

describe('WalletSlice type-guards', () => {
  const empty: WalletSlice = { connected: false }

  it('hasDisconnect', () => {
    expect(hasDisconnect(empty)).toBe(false)
    expect(hasDisconnect({ ...empty, disconnect: () => {} })).toBe(true)
  })

  it('hasSignMessage', () => {
    expect(hasSignMessage(empty)).toBe(false)
    expect(hasSignMessage({ ...empty, signMessage: async () => {} })).toBe(true)
  })

  it('hasSubmitTransfer', () => {
    expect(hasSubmitTransfer(empty)).toBe(false)
    expect(hasSubmitTransfer({ ...empty, submitTransfer: async () => {} })).toBe(true)
  })

  it('hasSubmitTransferInterpret', () => {
    expect(hasSubmitTransferInterpret(empty)).toBe(false)
    expect(hasSubmitTransferInterpret({ ...empty, submitTransferInterpret: async () => {} })).toBe(
      true,
    )
  })
})
