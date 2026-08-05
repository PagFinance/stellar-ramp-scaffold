// hooks/useCashout.ts
'use client'
//
// Orquestra o fluxo de cash-out (cripto → Pix) contra a Partner API:
//
//   validate(code)?  → getQuote(params)  → confirm()
//     → cria a intent (instrução blockchain) → a wallet ativa ASSINA e ENVIA
//     → polling do status até COMPLETED/FAILED/EXPIRED.
//
// A instrução vem do backend (partner-api), NÃO é montada no cliente. Aqui apenas
// embrulhamos a InterpretResponse com a instrução autoritativa da API e a
// entregamos direto ao WalletSlice, que assina/envia.
//
// Scaffold exclusivo do Stellar:
//   • Stellar → submitTransferInterpret: a intent NÃO serializa a tx; a instrução
//               carrega o memo autoritativo (MEMO_TEXT, ou MEMO_HASH do CID quando
//               passa de 28 bytes), repassado em result.memo/result.memoType. A
//               carteira monta e assina o Payment localmente com esse memo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { hasSubmitTransferInterpret, hasSubmitTransfer } from '@/lib/types/WalletSlice'
import type { InterpretResponse } from '@/lib/processor/InstructionInterpreter'
import type { AssetType } from '@/lib/types/AssetType'
import {
  postCashoutQuote,
  postCashoutIntent,
  getCashoutIntentStatus,
  postValidateCode,
  PartnerRequestError,
} from '@/lib/partner/browserClient'
import { getPartnerSession, establishPartnerSession } from '@/lib/partner/session'
import type {
  CashoutQuoteResponse,
  CashoutIntentResponse,
  CashoutIntentStatus,
  CashoutIntentStatusValue,
} from '@/lib/partner/types'

export type CashoutPhase =
  | 'idle'
  | 'authenticating'
  | 'validating'
  | 'quoting'
  | 'quoted'
  | 'creating'
  | 'signing'
  | 'polling'
  | 'completed'
  | 'failed'

/** Chains suportadas no cash-out pela partner-api (exclusivo Stellar). */
const SUPPORTED_CHAINS = new Set(['stellar'])
const TERMINAL: CashoutIntentStatusValue[] = ['COMPLETED', 'FAILED', 'EXPIRED']

// Polling de status com backoff adaptativo. O escopo /cashout da partner-api é
// limitado a 10 req/min por pubkey (compartilhado com quote + intent), então um
// intervalo fixo curto (o antigo 4s = 15/min) estoura o teto e recebe 429. Aqui
// começamos em ~5s e recuamos exponencialmente até 15s, com jitter para não
// sincronizar múltiplas abas na mesma janela do rate-limit. Um 429 explícito
// dispara um resfriamento maior para a janela de 1 min esvaziar.
const POLL_BASE_MS = 5_000
const POLL_MAX_MS = 15_000
const POLL_RATE_LIMIT_COOLDOWN_MS = 20_000
const POLL_TIMEOUT_MS = 5 * 60_000

/** Espalha o delay em ±15% para dessincronizar clientes concorrentes. */
const withJitter = (ms: number) => Math.round(ms * (0.85 + Math.random() * 0.3))

/**
 * Próximo intervalo de polling. Sob 429 recua até o teto + um resfriamento (a
 * janela do rate-limit upstream é de 1 min); senão, backoff exponencial
 * 5s → 10s → 15s (teto), sempre com jitter.
 */
const nextPollDelay = (attempt: number, rateLimited: boolean): number =>
  rateLimited
    ? withJitter(POLL_MAX_MS + POLL_RATE_LIMIT_COOLDOWN_MS)
    : withJitter(Math.min(POLL_BASE_MS * 2 ** attempt, POLL_MAX_MS))

export interface QuoteParams {
  /** Asset completo (vindo de accepted-cryptos) - usado no build da instrução EVM. */
  asset: AssetType
  amount: number
  invoiceCode: string
  externalId?: string
  fiatCurrency?: string
  invoiceType?: string
  invoiceTransferType?: string
  invoiceName?: string
  userTaxId?: string
  userEmail?: string
  message?: string
  webhookUrl?: string
}

export interface UseCashout {
  phase: CashoutPhase
  busy: boolean
  supported: boolean
  error: string | null
  quote: CashoutQuoteResponse | null
  intent: CashoutIntentResponse | null
  status: CashoutIntentStatus | null
  txHash: string | null
  validate: (code: string) => Promise<Record<string, unknown> | null>
  getQuote: (params: QuoteParams) => Promise<CashoutQuoteResponse | null>
  /** Retorna null em sucesso (tx enviada) ou a mensagem de erro. */
  confirm: () => Promise<string | null>
  reset: () => void
}

export function useCashout(): UseCashout {
  const { activeChainId, activeAddress, activeWallet } = useWalletWeb3()

  const [phase, setPhase] = useState<CashoutPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<CashoutQuoteResponse | null>(null)
  const [intent, setIntent] = useState<CashoutIntentResponse | null>(null)
  const [status, setStatus] = useState<CashoutIntentStatus | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Guarda o asset selecionado para montar a InterpretResponse na confirmação.
  const assetRef = useRef<AssetType | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supported = Boolean(activeChainId && SUPPORTED_CHAINS.has(activeChainId))
  const busy = [
    'authenticating',
    'validating',
    'quoting',
    'creating',
    'signing',
    'polling',
  ].includes(phase)

  const clearPoll = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  const reset = useCallback(() => {
    clearPoll()
    setPhase('idle')
    setError(null)
    setQuote(null)
    setIntent(null)
    setStatus(null)
    setTxHash(null)
    assetRef.current = null
  }, [])

  const toMessage = (e: unknown) =>
    e instanceof PartnerRequestError
      ? e.message
      : e instanceof Error
        ? e.message
        : 'Erro inesperado.'

  const validate = useCallback(async (code: string) => {
    setError(null)
    setPhase('validating')
    try {
      const data = await postValidateCode({ code })
      setPhase('idle')
      return data
    } catch (e) {
      setError(toMessage(e))
      setPhase('idle')
      return null
    }
  }, [])

  // Garante a sessão de carteira (prova-de-posse) antes de chamar as rotas
  // JWT-authed. Em dev (backend sem APP_SESSION_SECRET) é no-op. Idempotente: se
  // já há sessão para o address ativo, não repete a assinatura.
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!activeAddress || !activeChainId) {
      setError('Conecte uma carteira primeiro.')
      return false
    }
    try {
      const s = await getPartnerSession()
      if (!s.configured) return true // dev: sessão não exigida
      if (s.address && s.address === activeAddress) return true
      if (!activeWallet?.signMessage) {
        setError('A carteira ativa não suporta assinatura de mensagem para autenticar.')
        return false
      }
      setPhase('authenticating')
      const r = await establishPartnerSession({
        address: activeAddress,
        blockchain: activeChainId,
        publicKey: activeWallet.publicKey ?? null,
        signMessage: (m) => activeWallet.signMessage!(m),
      })
      if (!r.ok) {
        setError(r.error ?? 'Falha ao autenticar a carteira.')
        return false
      }
      return true
    } catch (e) {
      setError(toMessage(e))
      return false
    }
  }, [activeAddress, activeChainId, activeWallet])

  const getQuote = useCallback(
    async (params: QuoteParams) => {
      if (!activeAddress) {
        setError('Conecte uma carteira primeiro.')
        return null
      }
      if (!supported) {
        setError(`Cash-out não suportado para a rede ativa (${activeChainId ?? '-'}).`)
        return null
      }
      setError(null)
      if (!(await ensureSession())) {
        setPhase('idle')
        return null
      }
      setPhase('quoting')
      assetRef.current = params.asset
      try {
        const data = await postCashoutQuote({
          assetId: params.asset.id,
          amount: params.amount,
          externalId: params.externalId ?? `scaffold-${Date.now()}`,
          sender: activeAddress,
          invoiceCode: params.invoiceCode,
          fiatCurrency: params.fiatCurrency ?? 'brl',
          invoiceType: params.invoiceType,
          invoiceTransferType: params.invoiceTransferType ?? 'pix',
          invoiceName: params.invoiceName,
          userTaxId: params.userTaxId,
          userEmail: params.userEmail,
          message: params.message,
          webhookUrl: params.webhookUrl,
        })
        setQuote(data)
        setPhase('quoted')
        return data
      } catch (e) {
        setError(toMessage(e))
        setPhase('idle')
        return null
      }
    },
    [activeAddress, supported, activeChainId, ensureSession],
  )

  const pollStatus = useCallback((intentId: string, sender: string, deadline: number) => {
    let attempt = 0
    const tick = async () => {
      let rateLimited = false
      try {
        const s = await getCashoutIntentStatus(intentId, sender)
        setStatus(s)
        if (TERMINAL.includes(s.status)) {
          setPhase(s.status === 'COMPLETED' ? 'completed' : 'failed')
          if (s.status !== 'COMPLETED') setError(`Ordem ${s.status.toLowerCase()}.`)
          return
        }
        attempt += 1
      } catch (e) {
        // 429 (rate-limit) ganha um recuo maior; demais erros transitórios de
        // polling seguem com o backoff normal sem derrubar o fluxo.
        rateLimited = e instanceof PartnerRequestError && e.status === 429
        if (!rateLimited) attempt += 1
      }
      if (Date.now() >= deadline) {
        // Timeout de polling: crypto já foi enviada; segue processando no backend.
        setPhase('completed')
        return
      }
      pollTimer.current = setTimeout(tick, nextPollDelay(attempt, rateLimited))
    }
    pollTimer.current = setTimeout(tick, nextPollDelay(0, false))
  }, [])

  const confirm = useCallback(async (): Promise<string | null> => {
    if (!quote) {
      const m = 'Solicite uma cotação antes de confirmar.'
      setError(m)
      return m
    }
    if (!activeAddress || !activeWallet) {
      const m = 'Carteira não conectada.'
      setError(m)
      return m
    }
    const asset = assetRef.current
    if (!asset) {
      const m = 'Asset da cotação indisponível.'
      setError(m)
      return m
    }

    setError(null)
    if (!(await ensureSession())) {
      setPhase('quoted')
      return 'Autenticação da carteira necessária.'
    }
    setPhase('creating')
    try {
      // 1. Cria a intent → instrução blockchain autoritativa.
      const intentData = await postCashoutIntent(
        { quoteId: quote.quoteId, sender: activeAddress },
        quote.quoteId, // Idempotency-Key estável por cotação
      )
      setIntent(intentData)

      // 2. Monta a InterpretResponse com a instrução da API (sem reinterpretar).
      // Stellar não serializa uma tx no backend: a instrução carrega o memo
      // autoritativo (MEMO_TEXT quando cabe em 28 bytes, senão MEMO_HASH do CID),
      // que a carteira precisa anexar ao Payment que monta localmente. Sem ele o
      // pagamento vai on-chain sem memo e a liquidação não reconcilia a ordem.
      const stellarMemo =
        intentData.blockchain === 'stellar'
          ? (
              intentData.instruction as {
                memo?: { type: 'MEMO_TEXT' | 'MEMO_HASH' | 'MEMO_ID'; value: string }
              } | null
            )?.memo
          : undefined

      // O memo é a chave de reconciliação da ordem (paycrypto:<cid>, ou o hash dele).
      // Se a intent Stellar vier sem memo, abortar ANTES de assinar - um pagamento
      // sem memo liquida on-chain mas não casa com a ordem. Espelha a regra do XRPL
      // (receiver ausente é erro duro, nunca fallback).
      if (intentData.blockchain === 'stellar' && !stellarMemo?.value) {
        throw new Error('Instrução Stellar sem memo autoritativo; cash-out abortado.')
      }

      const response: InterpretResponse = {
        request: {
          sender: activeAddress,
          receiver: intentData.receiver,
          metadata: intentData.memo,
          amount: intentData.amount,
          asset,
        },
        result: {
          blockchain: intentData.blockchain,
          // string base64 da tx v0 (Solana) ou objeto Payment XRPL (Ripple)
          instruction: intentData.instruction as never,
          minContextSlot: intentData.minContextSlot ?? null,
          receiver: intentData.receiver,
          amount: intentData.amount,
          // Stellar: memo autoritativo montado pela API (undefined nas demais chains).
          memo: stellarMemo?.value,
          memoType: stellarMemo?.type,
        },
      }

      // 3. Wallet ativa assina e envia.
      setPhase('signing')
      let hash: string | null = null
      if (hasSubmitTransferInterpret(activeWallet)) {
        const res = await activeWallet.submitTransferInterpret(response)
        hash = (res && typeof res === 'object' && 'hash' in res ? (res.hash ?? null) : null) as
          string | null
      } else if (hasSubmitTransfer(activeWallet)) {
        const res = await activeWallet.submitTransfer(response.request)
        hash = (res && typeof res === 'object' && 'hash' in res ? (res.hash ?? null) : null) as
          string | null
      } else {
        throw new Error('A carteira ativa não suporta envio de transações.')
      }
      setTxHash(hash)

      // 4. Polling do status da ordem.
      setStatus(null)
      setPhase('polling')
      pollStatus(intentData.intentId, activeAddress, Date.now() + POLL_TIMEOUT_MS)
      return null
    } catch (e) {
      const m = toMessage(e)
      setError(m)
      setPhase('failed')
      return m
    }
  }, [quote, activeAddress, activeWallet, pollStatus, ensureSession])

  // Limpa o timer de polling ao desmontar (evita fetch/setState órfãos).
  useEffect(() => () => clearPoll(), [])

  return useMemo<UseCashout>(
    () => ({
      phase,
      busy,
      supported,
      error,
      quote,
      intent,
      status,
      txHash,
      validate,
      getQuote,
      confirm,
      reset,
    }),
    [
      phase,
      busy,
      supported,
      error,
      quote,
      intent,
      status,
      txHash,
      validate,
      getQuote,
      confirm,
      reset,
    ],
  )
}
