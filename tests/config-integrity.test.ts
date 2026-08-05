import { describe, it, expect, afterEach } from 'vitest'
import { gatewayConfig } from '@/lib/gatewayConfig'
import * as defaults from '@/lib/constants/defaultAssets'

const TOKEN_VARIANTS = new Set([
  'native',
  'credit_alphanum4',
  'credit_alphanum12',
  'issued',
  'unknown',
])

describe('gateway-config.json integrity (F3 - bad edits fail the build)', () => {
  const config = gatewayConfig()

  it('chain ids são únicos', () => {
    const ids = config.chains.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('asset ids são únicos globalmente', () => {
    const ids = config.chains.flatMap((c) => c.assets.map((a) => a.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('todo asset tem symbol/address/decimals válidos e tokenVariant conhecido', () => {
    for (const chain of config.chains) {
      for (const a of chain.assets) {
        expect(typeof a.symbol, `${chain.name}/${a.id} symbol`).toBe('string')
        expect(a.symbol.length, `${chain.name}/${a.id} symbol`).toBeGreaterThan(0)
        expect(typeof a.address, `${chain.name}/${a.id} address`).toBe('string')
        expect(a.address.length, `${chain.name}/${a.id} address`).toBeGreaterThan(0)
        expect(Number.isFinite(a.decimals), `${chain.name}/${a.id} decimals`).toBe(true)
        if (a.tokenVariant != null) {
          expect(TOKEN_VARIANTS.has(a.tokenVariant), `${chain.name}/${a.id} tokenVariant`).toBe(
            true,
          )
        }
      }
    }
  })
})

describe('defaultAssets consistentes com o catálogo (F1 - sem chainId errado/drift)', () => {
  const config = gatewayConfig()
  const idByName = (name: string) => config.chains.find((c) => c.name === name)?.id

  it('cada default aponta para o chainId correto do gateway', () => {
    const all = [defaults.defaultAssetStellar, defaults.defaultAssetStellarUsdc]
    for (const a of all) {
      expect(a.chainId, `${a.chainName}/${a.symbol}`).toBe(idByName(a.chainName))
    }
  })

  it('Stellar aponta para o chainId correto do gateway', () => {
    expect(defaults.defaultAssetStellar.chainId).toBe(idByName('Stellar'))
  })
})
