// lib/constants/defaultAssets.ts
//
// Ativo default do Stellar, DERIVADO de configs/gateway-config.json (a fonte
// única de verdade) em vez de duplicado à mão. Serve como referência para forks
// e, principalmente, como guarda de integridade validada em
// tests/config-integrity.test.ts (uma edição que remova/renomeie um símbolo
// esperado ou desalinhe o chainId falha o build).

import type { AssetType } from '@/lib/types/AssetType'
import type { BlockchainType } from '@/lib/types/BlockchainType'
import { gatewayConfig, getAssetBySymbol } from '@/lib/gatewayConfig'

/** Resolve um asset do catálogo por (chain, símbolo) ou lança (fail loud). */
function req(chainName: string, symbol: string): AssetType {
  const asset = getAssetBySymbol(chainName, symbol)
  if (!asset) {
    throw new Error(
      `defaultAssets: "${symbol}" em "${chainName}" não existe em gateway-config.json.`,
    )
  }
  return asset
}

export const defaultAssetStellar: AssetType = req('Stellar', 'XLM')
export const defaultAssetStellarUsdc: AssetType = req('Stellar', 'USDC')

/** Chain default (Stellar), derivada do catálogo. */
export const chainDefaultSelected: BlockchainType = (() => {
  const chain = gatewayConfig().chains.find((c) => c.name === 'Stellar')
  if (!chain) throw new Error('defaultAssets: chain "Stellar" não existe em gateway-config.json.')
  return { ...chain, assets: [defaultAssetStellar] }
})()
