import { describe, it, expect } from 'vitest'
import {
  CASHIN_NETWORK_KEY,
  CASHIN_ASSET_SYMBOL,
  getCashinAsset,
  getCashinAssetId,
  isAllowedCashinAssetId,
} from '@/lib/partner/cashinAssets'
import { gatewayConfig } from '@/lib/gatewayConfig'

describe('cash-in deste scaffold: apenas XLM', () => {
  it('o ativo ofertado é XLM na rede Stellar', () => {
    expect(CASHIN_NETWORK_KEY).toBe('stellar')
    expect(CASHIN_ASSET_SYMBOL).toBe('XLM')

    const asset = getCashinAsset()
    expect(asset).not.toBeNull()
    expect(asset!.symbol).toBe('XLM')
    expect(asset!.chainName).toBe('Stellar')
    expect(asset!.chainId).toBe(13)
  })

  // O assetId é o contrato com a partner-api (vai no POST /cashin/quote).
  it('respeita o assetId do gateway-config (XLM = 100)', () => {
    expect(getCashinAssetId()).toBe(100)

    const source = gatewayConfig()
      .chains.flatMap((c) => c.assets)
      .find((a) => a.id === 100)
    expect(source?.symbol).toBe('XLM')
    expect(source?.address).toBe('native')
    expect(getCashinAsset()!.decimals).toBe(source!.decimals)
  })

  it('USDC e BRLP da Stellar não são compráveis via cash-in', () => {
    // Existem no gateway-config (101 / 102) mas ficam fora da oferta.
    expect(isAllowedCashinAssetId(101)).toBe(false)
    expect(isAllowedCashinAssetId(102)).toBe(false)
    expect(isAllowedCashinAssetId(1)).toBe(false)
  })

  it('aceita o id de XLM e o caso sem assetId (fluxo legado)', () => {
    expect(isAllowedCashinAssetId(100)).toBe(true)
    expect(isAllowedCashinAssetId(null)).toBe(true)
    expect(isAllowedCashinAssetId(undefined)).toBe(true)
  })
})
