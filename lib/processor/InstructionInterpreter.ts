// lib/processor/InstructionInterpreter.ts
//
// Tipos de transporte da instrução de transferência. NÃO há interpretação no
// cliente: a partner-api monta o payload autoritativo e o entrega via
// `InterpretResponse`. Estes tipos existem só para tipar essa resposta e o que
// os `WalletSlice.submit*` consomem.
//
// No Stellar a instrução NÃO serializa a tx: a carteira monta o Payment
// localmente a partir de `receiver`/`amount`/`memo` autoritativos.
import type { AssetType } from '@/lib/types/AssetType'

export type InterpretRequest = {
  sender: string
  receiver: string
  metadata: string // "paycrypto:..." || "buycrypto:..."
  amount: number
  asset: AssetType
}

export type RawInstruction = {
  blockchain: string
  instruction: string
  minContextSlot?: unknown | null
  // Campos usados pelo Stellar (memo autoritativo montado pela partner-api).
  memo?: string
  memoType?: 'MEMO_TEXT' | 'MEMO_HASH' | 'MEMO_ID'
  receiver?: string
  amount?: number
}

/**
 * Resposta de interpretação vinda da partner-api (formato "endpoints Next-first").
 * A `result` é sempre produzida pelo backend; o cliente apenas assina/envia.
 */
export type InterpretResponse = { request: InterpretRequest; result: RawInstruction }
