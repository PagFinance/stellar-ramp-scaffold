// hooks/useCashin.ts
'use client'
//
// Orquestra o fluxo de cash-in / onramp (Pix → cripto) contra a Partner API,
// no fluxo canônico quote → intent → status:
//
//   requestQuote({ amount }) → cota fiat→cripto (mostra quanto de cripto o
//     usuário recebe + preço) e devolve um `quoteId` de uso único.
//   confirmCharge({ customer? }) → cria a cobrança amarrada ao quoteId,
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
  // A cobrança continua de pé, mas o app perdeu a sessão e PAROU de acompanhar.
  // Distinta de 'failed' de propósito: nada falhou no pagamento, só no nosso
  // acompanhamento dele, e o QR segue pagável.
  | 'tracking_lost'
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
  /** Dados do pagador - opcionais. Omita quando nada foi preenchido. */
  customer?: CashinCustomer
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
  /** Reautentica e volta a acompanhar a cobrança atual após 'tracking_lost'. */
  resumeTracking: () => Promise<boolean>
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
  // O sender com que ESTA cobrança foi criada. Não é o mesmo que `activeAddress`:
  // a carteira ativa é derivada de "primeira chain conectada" (useWalletWeb3) e
  // muda sozinha quando a conexão de uma chain cai. Retomar o polling com o
  // endereço de agora pediria o status de uma cobrança de outra carteira, que a
  // rota recusa com 403.
  const chargeSender = useRef<string | null>(null)

  const busy = phase === 'quoting' || phase === 'creating'

  const clearPoll = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  const reset = useCallback(() => {
    clearPoll()
    chargeSender.current = null
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
      } catch (e) {
        // Nem todo erro de polling é transitório, e tratar os dois casos igual foi
        // o que travou a tela: a sessão de carteira expira em 1h sem renovação
        // (lib/server/partnerSession.ts), a rota passa a responder 401
        // SESSION_REQUIRED, e nada aqui reautentica. Antes isto caía num `catch {}`
        // vazio, então o loop repetia o MESMO 401 a cada 4s sem sair de
        // `awaiting_payment`: cobranças pagas e entregues on-chain seguiam exibindo
        // "Aguardando pagamento" para sempre. E a aba zumbi continuava gastando o
        // orçamento de 60 req/min por IP do rate-limit (lib/partner/routeHelpers.ts),
        // provocando 429 nas abas vivas.
        //
        // 401 (sessão ausente/expirada) e 403 (sender não bate com a sessão) são
        // definitivos: repetir devolve o mesmo erro. Param o loop e viram estado
        // visível. Todo o resto (rede oscilando, 429, 5xx) é transitório de verdade
        // e continua no loop, que é o comportamento que valia a pena preservar.
        if (e instanceof PartnerRequestError && (e.status === 401 || e.status === 403)) {
          pollTimer.current = null
          setError(`${e.message} A cobrança continua válida: retome o acompanhamento.`)
          setPhase('tracking_lost')
          return
        }
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
        // Guardado para o resume: a carteira ativa pode mudar sozinha depois daqui.
        chargeSender.current = activeAddress
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

  // Retoma o acompanhamento de uma cobrança que caiu em 'tracking_lost'. Exige a
  // MESMA carteira que criou a cobrança: a sessão prova posse de um endereço, e o
  // status é lido sob ele. Reconectar outra carteira e reassinar produziria uma
  // sessão válida para o endereço errado, e o polling seguiria em 403.
  const resumeTracking = useCallback(async (): Promise<boolean> => {
    const sender = chargeSender.current
    const intentId = charge?.intentId
    if (!sender || !intentId) return false
    if (activeAddress !== sender) {
      setError(
        `Reconecte a carteira que criou esta cobrança (${sender}) para retomar o acompanhamento.`,
      )
      return false
    }
    if (!(await ensureSession())) return false
    clearPoll()
    setError(null)
    setPhase('awaiting_payment')
    pollStatus(intentId, sender)
    return true
  }, [charge, activeAddress, ensureSession, pollStatus])

  // Limpa o timer de polling ao desmontar (evita fetch/setState órfãos).
  useEffect(() => () => clearPoll(), [])

  return useMemo<UseCashin>(
    () => ({
      phase,
      busy,
      error,
      quote,
      charge,
      status,
      requestQuote,
      confirmCharge,
      resumeTracking,
      reset,
    }),
    [phase, busy, error, quote, charge, status, requestQuote, confirmCharge, resumeTracking, reset],
  )
}
