// hooks/useCashin.ts
'use client'
//
// Orquestra o fluxo de cash-in / onramp (Pix → cripto) contra a Partner API,
// no fluxo canônico quote → intent → status:
//
//   requestQuote({ amount }) → cota fiat→cripto (mostra quanto de cripto o
//     usuário recebe + preço) e devolve um `quoteId` de uso único.
//   confirmCharge({ customer }) → cria a cobrança amarrada ao quoteId,
//     renderiza o QR (brCode/qrCodeImage) e faz polling do status até
//     COMPLETED/EXPIRED.
//
// Independe da chain - só precisa de uma wallet conectada para usar o endereço
// como `sender` (o backend Next minta o JWT do usuário a partir dele).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import {
  postCashinQuote,
  postCashinIntent,
  getCashinIntentStatus,
  PartnerRequestError,
} from '@/lib/partner/browserClient'
import { getPartnerSession, establishPartnerSession } from '@/lib/partner/session'
import type {
  CashinCustomer,
  CashinQuoteResponse,
  CashinIntentResponse,
  CashinIntentStatus,
} from '@/lib/partner/types'

export type CashinPhase =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'creating'
  | 'awaiting_payment'
  | 'completed'
  | 'expired'
  | 'failed'

const POLL_INTERVAL_MS = 4_000
const PAID_STATUSES = new Set(['COMPLETED', 'PAID', 'CONFIRMED'])
const DEAD_STATUSES = new Set(['EXPIRED', 'CANCELLED', 'FAILED'])

export interface RequestQuoteInput {
  amount: number
  assetId?: number
  fiatCurrency?: string
  // Carteira de destino da entrega on-chain (onramp). Só deve ser preenchido pelo
  // chamador quando o par (rede ativa, asset) é validável pela partner-api - ver
  // `lib/partner/onrampDelivery.ts#isDeliverableDestination`. Para redes não
  // entregáveis, omita: o cash-in segue o caminho legado (backend credita).
  destinationWallet?: string
}

export interface ConfirmChargeInput {
  customer: CashinCustomer
  expiresIn?: number
  comment?: string
  webhookUrl?: string
}

export interface UseCashin {
  phase: CashinPhase
  busy: boolean
  error: string | null
  quote: CashinQuoteResponse | null
  charge: CashinIntentResponse | null
  status: CashinIntentStatus | null
  requestQuote: (input: RequestQuoteInput) => Promise<CashinQuoteResponse | null>
  confirmCharge: (input: ConfirmChargeInput) => Promise<CashinIntentResponse | null>
  reset: () => void
}

export function useCashin(): UseCashin {
  const { activeAddress, activeChainId, activeWallet } = useWalletWeb3()

  const [phase, setPhase] = useState<CashinPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<CashinQuoteResponse | null>(null)
  const [charge, setCharge] = useState<CashinIntentResponse | null>(null)
  const [status, setStatus] = useState<CashinIntentStatus | null>(null)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deadline = useRef<number>(0)

  const busy = phase === 'quoting' || phase === 'creating'

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
    setCharge(null)
    setStatus(null)
  }, [])

  const toMessage = (e: unknown) =>
    e instanceof PartnerRequestError
      ? e.message
      : e instanceof Error
        ? e.message
        : 'Erro inesperado.'

  // Garante a sessão de carteira (prova-de-posse) antes das rotas JWT-authed -
  // as rotas de cash-in derivam o `sender` da sessão (fecha o BUG-H3). No-op em
  // dev (backend sem APP_SESSION_SECRET). Mesma lógica de useCashout.ensureSession.
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!activeAddress || !activeChainId) {
      setError('Conecte uma carteira primeiro.')
      return false
    }
    try {
      const s = await getPartnerSession()
      if (!s.configured) return true
      if (s.address && s.address === activeAddress) return true
      if (!activeWallet?.signMessage) {
        setError('A carteira ativa não suporta assinatura de mensagem para autenticar.')
        return false
      }
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

  const pollStatus = useCallback((intentId: string, sender: string) => {
    const tick = async () => {
      try {
        const s = await getCashinIntentStatus(intentId, sender)
        setStatus(s)
        const st = String(s.status ?? '').toUpperCase()
        if (PAID_STATUSES.has(st)) {
          setPhase('completed')
          return
        }
        if (DEAD_STATUSES.has(st)) {
          setPhase('expired')
          return
        }
      } catch {
        // erros transitórios de polling não derrubam o fluxo
      }
      if (Date.now() >= deadline.current) return // deixa de acompanhar após expiração
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
    }
    pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
  }, [])

  const requestQuote = useCallback(
    async (input: RequestQuoteInput) => {
      if (!activeAddress) {
        setError('Conecte uma carteira primeiro.')
        return null
      }
      clearPoll()
      setError(null)
      setCharge(null)
      setStatus(null)
      if (!(await ensureSession())) {
        setPhase('idle')
        return null
      }
      setPhase('quoting')
      try {
        const data = await postCashinQuote({
          sender: activeAddress,
          amount: input.amount,
          assetId: input.assetId,
          fiatCurrency: input.fiatCurrency,
          destinationWallet: input.destinationWallet,
        })
        setQuote(data)
        setPhase('quoted')
        return data
      } catch (e) {
        setError(toMessage(e))
        setPhase('failed')
        return null
      }
    },
    [activeAddress, ensureSession],
  )

  const confirmCharge = useCallback(
    async (input: ConfirmChargeInput) => {
      if (!activeAddress) {
        setError('Conecte uma carteira primeiro.')
        return null
      }
      if (!quote) {
        setError('Gere uma cotação antes de criar a cobrança.')
        return null
      }
      setError(null)
      setStatus(null)
      if (!(await ensureSession())) {
        setPhase('quoted')
        return null
      }
      setPhase('creating')
      try {
        const data = await postCashinIntent(
          {
            sender: activeAddress,
            amount: quote.valuesAndFees.paymentInFiat,
            quoteId: quote.quoteId,
            customer: input.customer,
            expiresIn: input.expiresIn,
            comment: input.comment,
            webhookUrl: input.webhookUrl,
          },
          // Chave estável por cotação: retentar não gera cobrança duplicada.
          `cashin-intent-${quote.quoteId}`,
        )
        setCharge(data)
        setPhase('awaiting_payment')
        deadline.current = Date.now() + (data.expiresIn ?? 3600) * 1000
        pollStatus(data.intentId ?? data.correlationID, activeAddress)
        return data
      } catch (e) {
        setError(toMessage(e))
        setPhase('failed')
        return null
      }
    },
    [activeAddress, quote, pollStatus, ensureSession],
  )

  // Limpa o timer de polling ao desmontar (evita fetch/setState órfãos).
  useEffect(() => () => clearPoll(), [])

  return useMemo<UseCashin>(
    () => ({ phase, busy, error, quote, charge, status, requestQuote, confirmCharge, reset }),
    [phase, busy, error, quote, charge, status, requestQuote, confirmCharge, reset],
  )
}
