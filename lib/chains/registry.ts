// lib/chains/registry.ts
//
// Fonte única de verdade das chains suportadas (Chain Registry).
//
// Este scaffold é EXCLUSIVO do ecossistema Stellar. O registry mantém uma única
// entrada; os consumidores (guard, providers, ConnectModal, useWalletWeb3)
// DERIVAM desta lista, então nada precisa hardcodar a chain.

import type { ChainId } from '@/lib/types/ChainTypes'

export interface ChainMeta {
  id: ChainId
  /** Rótulo curto para UI (ex.: "Stellar"). */
  label: string
  /** Ícone (URL) exibido no seletor de carteira. */
  icon: string
}

// Ordem canônica (UI e resolução da chain "ativa").
export const CHAIN_ORDER: ChainId[] = ['stellar']

export const CHAIN_REGISTRY: Record<ChainId, ChainMeta> = {
  stellar: {
    id: 'stellar',
    label: 'Stellar',
    icon: '/icons/chains/stellar.png',
  },
}

/** Lista ordenada dos módulos de chain (para iterar em UI/derivações). */
export const CHAIN_MODULES: ChainMeta[] = CHAIN_ORDER.map((id) => CHAIN_REGISTRY[id])

// ---------------------------------------------------------------------------
// Resolução de chain-identity (nome de rede → ChainId)
// ---------------------------------------------------------------------------

/** Mapeia um nome de rede (chainName) para o ChainId canônico, ou null. */
export function resolveChainId(chainName: string): ChainId | null {
  const n = (chainName ?? '').toLowerCase()
  if (n === 'stellar' || n === 'xlm') return 'stellar'
  return null
}
