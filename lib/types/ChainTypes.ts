// lib/types/ChainTypes.ts

import { CHAIN_ORDER } from '@/lib/chains/registry'

// --------------------------------------
// Chains
// --------------------------------------

// Este scaffold é EXCLUSIVO do ecossistema Stellar: a union `ChainId` tem uma
// única variante. A LISTA/ordem é derivada do Chain Registry (fonte única).
export type ChainId = 'stellar'
export const ChainsIDS: ChainId[] = CHAIN_ORDER
export type ChainIdUnified = ChainId | null | undefined

export const CHAIN_IDS = new Set<ChainId>(CHAIN_ORDER)

export function isChainId(value: string): value is ChainId {
  return CHAIN_IDS.has(value as ChainId)
}
