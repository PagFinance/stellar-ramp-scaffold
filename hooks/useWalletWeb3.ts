// hooks/useWalletWeb3.ts
'use client'

import { useMemo } from 'react'
import type { ChainSlice, WalletSlice } from '@/lib/types/WalletSlice'
import type { ChainId } from '@/lib/types/ChainTypes'
import { CHAIN_ORDER } from '@/lib/chains/registry'

// Slice da chain - encapsulada no seu módulo (lib/chains/<id>/useSlice).
// Este scaffold é exclusivo do Stellar: há uma única slice.
import { useStellarSlice } from '@/lib/chains/stellar/useSlice'

export type UseWalletWeb3Result = {
  activeChainId: ChainId | null
  activeAddress: string | null
  isConnected: boolean
  isReadyForAuth: boolean
  activeWallet: WalletSlice | null
  chains: {
    stellar: ChainSlice
  }
}

export function useWalletWeb3(): UseWalletWeb3Result {
  const stellar = useStellarSlice()

  // Mapa por ChainId (para derivar de CHAIN_ORDER sem if/switch).
  const slices = useMemo<Record<ChainId, ChainSlice>>(() => ({ stellar }), [stellar])

  // Chain ativa = primeira conectada na ordem canônica.
  const activeChainId: ChainId | null = useMemo(
    () => CHAIN_ORDER.find((id) => slices[id]?.connected) ?? null,
    [slices],
  )

  const activeWallet: WalletSlice | null = useMemo(
    () => (activeChainId ? slices[activeChainId] : null),
    [activeChainId, slices],
  )

  return {
    activeChainId,
    activeAddress: activeWallet?.address ?? null,
    isConnected: Boolean(activeChainId),
    isReadyForAuth: Boolean(activeWallet?.readyForAuth),
    activeWallet,
    chains: { stellar },
  }
}
