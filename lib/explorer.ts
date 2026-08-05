// lib/explorer.ts
//
// URLs de block explorer, para o "chip de conta" e para os links "ver no
// explorer" dos toasts. Este scaffold é exclusivo do Stellar.

import type { ChainId } from '@/lib/types/ChainTypes'

type Builder = (v: string) => string

const ADDRESS: Partial<Record<ChainId, Builder>> = {
  stellar: (a) => `https://stellar.expert/explorer/public/account/${a}`,
}

const TX: Partial<Record<ChainId, Builder>> = {
  stellar: (h) => `https://stellar.expert/explorer/public/tx/${h}`,
}

export function explorerAddressUrl(
  chain: ChainId | null | undefined,
  address: string,
): string | null {
  if (!chain || !address) return null
  return ADDRESS[chain]?.(address) ?? null
}

export function explorerTxUrl(chain: ChainId | null | undefined, hash: string): string | null {
  if (!chain || !hash) return null
  return TX[chain]?.(hash) ?? null
}
