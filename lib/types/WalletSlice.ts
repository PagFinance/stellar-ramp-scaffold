// lib/types/WalletSlice.ts

import type { ChainIdUnified } from '@/lib/types/ChainTypes'
import type { InterpretRequest, InterpretResponse } from '@/lib/processor/InstructionInterpreter'

// --------------------------------------
// Results
// --------------------------------------
export type SignatureResult = {
  message: string
  signature?: string | null
  publicKey?: string | null
  address?: string | null
  nonce?: string | null
  issuedAt?: string | null
  data?: any | null
  err?: string | null
}

/**
 * Resultado padrão de transferências.
 * - `hash`: id/tx-hash comum para UI
 * - `extra`: payload bruto específico da chain (ex.: resposta do Horizon)
 */
export type TransferResult<TExtra = unknown> = {
  hash?: string | null
  extra?: TExtra
}

/** Núcleo comum de estado que toda carteira expõe */
export interface WalletSliceCore {
  chainId: ChainIdUnified
  connected: boolean
  /** Handshake de conexão em andamento (popup/aprovação aberta). */
  connecting?: boolean
  address: string | null
  readyForAuth: boolean
  busy?: boolean
  label?: string
  /** Nome real da carteira conectada (ex.: Phantom, MetaMask, GemWallet). Útil para telemetria/UI. */
  walletName?: string | null
}

/** Ações opcionais (unificadas) */
export interface WalletActionFns {
  publicKey?: string | null
  connect?: () => Promise<void> | void
  disconnect?: () => Promise<void> | void
  signMessage?: (message: string) => Promise<SignatureResult | void>
  /** Submete uma transferência interpretada no cliente (req-based). */
  submitTransfer?: (req: InterpretRequest) => Promise<TransferResult | void>
  /** Submete uma instrução já interpretada (response-based). Usado pelo Stellar. */
  submitTransferInterpret?: (response: InterpretResponse) => Promise<TransferResult | void>
}

/** Tipo unificado: estado + (opcionais) ações */
export type WalletSlice = Partial<WalletSliceCore> & Partial<WalletActionFns>

/** Aliases para compatibilidade */
export type ChainSlice = WalletSlice

// -------- Helpers (type-guards) --------
export function hasDisconnect(
  s: WalletSlice,
): s is WalletSlice & { disconnect: () => Promise<void> | void } {
  return typeof s.disconnect === 'function'
}
export function hasSignMessage(
  s: WalletSlice,
): s is WalletSlice & { signMessage: (msg: string) => Promise<SignatureResult | unknown> } {
  return typeof s.signMessage === 'function'
}
export function hasSubmitTransfer(s: WalletSlice): s is WalletSlice & {
  submitTransfer: (req: InterpretRequest) => Promise<TransferResult | unknown>
} {
  return typeof s.submitTransfer === 'function'
}
export function hasSubmitTransferInterpret(s: WalletSlice): s is WalletSlice & {
  submitTransferInterpret: (response: InterpretResponse) => Promise<TransferResult | unknown>
} {
  return typeof s.submitTransferInterpret === 'function'
}
