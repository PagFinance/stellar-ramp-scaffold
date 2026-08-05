'use client'
//
// Slice unificado (WalletSlice) do Stellar (Stellar Wallets Kit).

import { useMemo } from 'react'
import { useStellarWallet } from '@/contexts/StellarWalletProvider'
import type { ChainSlice } from '@/lib/types/WalletSlice'
import type { InterpretResponse } from '@/lib/processor/InstructionInterpreter'
import { stellarSignMessage, stellarSubmitInterpret } from '@/lib/actions/stellar-actions'

export function useStellarSlice(): ChainSlice {
  const stellar = useStellarWallet()
  return useMemo<ChainSlice>(
    () => ({
      chainId: 'stellar',
      label: 'Stellar',
      walletName: stellar.connected ? 'Stellar' : null,
      connected: Boolean(stellar.connected),
      connecting: Boolean(stellar.connecting),
      address: stellar.address ?? null,
      readyForAuth: Boolean(stellar.connected && stellar.address),
      connect: () => stellar.connect(),
      disconnect: () => stellar.disconnect(),
      signMessage: (msg: string) => stellarSignMessage(stellar, msg),
      submitTransferInterpret: (response: InterpretResponse) =>
        stellarSubmitInterpret(stellar, response),
    }),
    [
      stellar.connected,
      stellar.connecting,
      stellar.address,
      stellar.connect,
      stellar.disconnect,
      stellar.signMessage,
    ],
  )
}
