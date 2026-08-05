import { describe, it, expect } from 'vitest'
import { CHAIN_REGISTRY, CHAIN_ORDER, CHAIN_MODULES } from '@/lib/chains/registry'
import { ChainsIDS, CHAIN_IDS } from '@/lib/types/ChainTypes'

describe('chain registry', () => {
  it('CHAIN_ORDER cobre exatamente as chaves de CHAIN_REGISTRY', () => {
    expect([...CHAIN_ORDER].sort()).toEqual(Object.keys(CHAIN_REGISTRY).sort())
  })

  it('cada entrada tem id/label/icon coerentes', () => {
    for (const id of CHAIN_ORDER) {
      const m = CHAIN_REGISTRY[id]
      expect(m.id).toBe(id)
      expect(m.label.length).toBeGreaterThan(0)
      // ícone: URL absoluta (http/https) ou asset local root-relative (/icons/...)
      expect(m.icon).toMatch(/^(https?:\/\/|\/)/)
    }
  })

  it('ChainsIDS e CHAIN_IDS derivam do registry (fonte única)', () => {
    expect(ChainsIDS).toEqual(CHAIN_ORDER)
    expect([...CHAIN_IDS].sort()).toEqual([...CHAIN_ORDER].sort())
  })

  it('CHAIN_MODULES segue a ordem canônica', () => {
    expect(CHAIN_MODULES.map((m) => m.id)).toEqual(CHAIN_ORDER)
  })
})
