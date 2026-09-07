// @vitest-environment jsdom
//
// tests/useCashin.test.ts
//
// Cobre o comportamento que originou a fase `tracking_lost`: uma cobrança paga e
// entregue on-chain seguia exibindo "Aguardando pagamento" porque o polling engolia
// o 401 e repetia a mesma falha a cada 4s. O que precisa estar sob teste é a
// CLASSIFICAÇÃO do erro (fatal x transitório) e a retomada - não o happy path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useCashin } from '@/hooks/useCashin'
import { PartnerRequestError } from '@/lib/partner/browserClient'

const ADDR = 'GCEXAMPLEADDRESS7777777777777777777777777777777777777777'
const POLL_MS = 4_000

// A cobrança devolvida SEM `intentId`: a partner-api pode responder só com
// `correlationID`, e é ele que `pollStatus` acompanha. Antes, o resume lia
// `charge.intentId` e essas cobranças ficavam sem retomada possível.
const CHARGE = { correlationID: 'corr-123', brCode: '000201…', valueCents: 500, expiresIn: 3600 }

const postCashinQuote = vi.fn()
const postCashinIntent = vi.fn()
const getCashinIntentStatus = vi.fn()

vi.mock('@/hooks/useWalletWeb3', () => ({
  useWalletWeb3: () => ({
    activeAddress: ADDR,
    activeChainId: 'stellar',
    activeWallet: { publicKey: ADDR, signMessage: vi.fn() },
  }),
}))

// Sessão "não configurada" (dev): `ensureSession` vira no-op e sai do caminho.
vi.mock('@/lib/partner/session', () => ({
  getPartnerSession: async () => ({ configured: false, address: null }),
  establishPartnerSession: async () => ({ ok: true }),
  endPartnerSession: async () => {},
}))

vi.mock('@/lib/partner/browserClient', async (importOriginal) => ({
  // `PartnerRequestError` REAL: é a classe que o hook usa no `instanceof` para
  // decidir entre parar e continuar. Um dublê aqui testaria o dublê.
  ...(await importOriginal<typeof import('@/lib/partner/browserClient')>()),
  postCashinQuote: (...a: unknown[]) => postCashinQuote(...a),
  postCashinIntent: (...a: unknown[]) => postCashinIntent(...a),
  getCashinIntentStatus: (...a: unknown[]) => getCashinIntentStatus(...a),
}))

/** Leva o hook até `awaiting_payment`, com o polling armado. */
async function untilAwaitingPayment() {
  const view = renderHook(() => useCashin())
  await act(async () => {
    await view.result.current.requestQuote({ amount: 50 })
  })
  await act(async () => {
    await view.result.current.confirmCharge({})
  })
  expect(view.result.current.phase).toBe('awaiting_payment')
  return view
}

describe('useCashin - acompanhamento do status', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    postCashinQuote.mockResolvedValue({ quoteId: 'q-1', valuesAndFees: {}, ttlSeconds: 60 })
    postCashinIntent.mockResolvedValue(CHARGE)
    getCashinIntentStatus.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('401 no polling para o loop e vira tracking_lost (não "aguardando pagamento")', async () => {
    getCashinIntentStatus.mockRejectedValue(
      new PartnerRequestError(401, 'Sessão expirada.', 'SESSION_REQUIRED'),
    )
    const view = await untilAwaitingPayment()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(view.result.current.phase).toBe('tracking_lost')
    expect(view.result.current.error).toContain('retome o acompanhamento')

    // E PARA de fato: era a repetição a cada 4s que queimava o rate-limit de 60
    // req/min por IP e produzia 429 nas abas saudáveis.
    const callsWhenLost = getCashinIntentStatus.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    })
    expect(getCashinIntentStatus).toHaveBeenCalledTimes(callsWhenLost)
  })

  it('403 (sender não bate com a sessão) também é fatal', async () => {
    getCashinIntentStatus.mockRejectedValue(new PartnerRequestError(403, 'Sender inválido.'))
    const view = await untilAwaitingPayment()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(view.result.current.phase).toBe('tracking_lost')
  })

  it('429 e 5xx continuam transitórios: o loop segue e a fase não muda', async () => {
    getCashinIntentStatus
      .mockRejectedValueOnce(new PartnerRequestError(429, 'Muitas requisições.'))
      .mockRejectedValueOnce(new PartnerRequestError(500, 'Erro no parceiro.'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ status: 'COMPLETED' })

    const view = await untilAwaitingPayment()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    })
    // Três falhas seguidas e ainda acompanhando - nenhuma delas é definitiva.
    expect(view.result.current.phase).toBe('awaiting_payment')
    expect(getCashinIntentStatus).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    await waitFor(() => expect(view.result.current.phase).toBe('completed'))
  })

  it('resumeTracking retoma uma cobrança que só tem correlationID', async () => {
    getCashinIntentStatus.mockRejectedValue(new PartnerRequestError(401, 'Sessão expirada.'))
    const view = await untilAwaitingPayment()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(view.result.current.phase).toBe('tracking_lost')

    // O id acompanhado é o `correlationID`, não um `intentId` que nunca veio.
    expect(getCashinIntentStatus).toHaveBeenLastCalledWith(CHARGE.correlationID, ADDR)

    getCashinIntentStatus.mockResolvedValue({ status: 'COMPLETED' })
    let ok = false
    await act(async () => {
      ok = await view.result.current.resumeTracking()
    })
    expect(ok).toBe(true)
    expect(view.result.current.phase).toBe('awaiting_payment')
    expect(view.result.current.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    await waitFor(() => expect(view.result.current.phase).toBe('completed'))
  })

  it('resumeTracking sem cobrança em curso explica por que recusou', async () => {
    const view = renderHook(() => useCashin())
    let ok = true
    await act(async () => {
      ok = await view.result.current.resumeTracking()
    })
    expect(ok).toBe(false)
    expect(view.result.current.error).toContain('Não há cobrança em acompanhamento')
  })
})
