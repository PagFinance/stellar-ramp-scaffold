import type { AssetType } from '@/lib/types/AssetType'

import config from '../configs/gateway-config.json'
import type { GatewayConfigType } from '@/lib/types/GatewayConfigType'
import type { BlockchainType } from '@/lib/types/BlockchainType'

// O JSON é validado estruturalmente por tests/config-integrity.test.ts (ids
// únicos, campos obrigatórios, tokenVariant válido) - então falhas de edição
// quebram o build em vez de vazarem em runtime. O cast é honesto (JSON → tipo).
export function gatewayConfig(): GatewayConfigType {
  return config as unknown as GatewayConfigType
}

/** Busca um asset por (nome da chain, símbolo), já com chainName/chainId injetados. */
export function getAssetBySymbol(chainName: string, symbol: string): AssetType | null {
  const chain = gatewayConfig().chains.find((c) => c.name.toLowerCase() === chainName.toLowerCase())
  if (!chain) return null
  const asset = chain.assets.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase())
  if (!asset) return null
  return { ...asset, chainName: chain.name, chainId: chain.id }
}

export function getAllActiveChains(): BlockchainType[] {
  return gatewayConfig().chains.filter((asset) => asset.status == true)
}

export function getAllActiveAssets(): AssetType[] {
  return gatewayConfig()
    .chains.filter((chain) => chain.status === true)
    .flatMap((chain) => chain.assets.filter((asset) => asset.status))
}

export function findChainByKey(key: string): BlockchainType | null {
  const dataChains = getAllActiveChains()
  return dataChains.find((c) => c.key?.toLowerCase() === key.toLowerCase()) ?? null
}

export function findChainByFamily(family: string): BlockchainType | null {
  const dataChains = getAllActiveChains()
  return dataChains.find((c) => c.family?.toLowerCase() === family.toLowerCase()) ?? null
}

export function getAcceptedCryptos(chain: string): BlockchainType {
  const config = gatewayConfig()
  const dataChains = config.chains
  const selectedChain =
    dataChains.find((item) => item.name.toLowerCase() === chain.toLowerCase()) ?? dataChains[0]
  const assetTypeList = selectedChain.assets
    .filter((asset) => asset.status)
    .sort((a, b) => a.order - b.order)

  return {
    ...selectedChain,
    assets: assetTypeList,
  }
}

export function getAcceptedCryptosByChainId(chainId: number): BlockchainType {
  const config = gatewayConfig()
  const dataChains = config.chains
  const selectedChain = dataChains.find((item) => item.id === chainId) ?? dataChains[0]
  const assetTypeList = selectedChain.assets
    .filter((asset) => asset.status)
    .sort((a, b) => a.order - b.order)

  return {
    ...selectedChain,
    assets: assetTypeList,
  }
}

export function findAssetById(assetId: number): AssetType | null {
  const config = gatewayConfig()
  return findAssetByIdInArray(assetId, config.chains)
}

export function findAssetByIdInArray(assetId: number, chains: BlockchainType[]): AssetType | null {
  for (const chain of chains) {
    for (const asset of chain.assets) {
      if (asset.id === assetId) {
        return {
          ...asset,
          chainName: chain.name,
          chainId: chain.id,
        }
      }
    }
  }

  return null
}
