import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocka só as funções de rede do partnerClient, preservando as classes de erro
// reais (routeHelpers faz `instanceof PartnerApiError`).
vi.mock('@/lib/partner/partnerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/partner/partnerClient')>()
  return {
    ...actual,
    cashinQuote: vi.fn(),
    cashinIntent: vi.fn(),
    cashinIntentStatus: vi.fn(),
  }
})

import * as client from '@/lib/partner/partnerClient'
import { POST as quotePOST } from '@/app/api/partner/cashin/quote/route'
import { POST as intentPOST } from '@/app/api/partner/cashin/intent/route'
import { GET as statusGET } from '@/app/api/partner/cashin/intent/[intentId]/route'

const SENDER = '0x1234567890abcdef1234567890abcdef12345678'

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  vi.mocked(client.cashinQuote).mockResolvedValue({
    quoteId: 'q_1',
    expiresAt: '2026-01-01T00:00:00Z',
    ttlSeconds: 300,
    valuesAndFees: {
      paymentInFiat: 50,
      paymentInCrypto: 8.9,
      networkFeeFiat: 0,
      networkFeeCrypto: 0,
      processingFeeFiat: 1.25,
      processingFeeCrypto: 0.2,
      totalFeeFiat: 1.25,
      totalFeeCrypto: 0.2,
      totalFiat: 50,
      totalCrypto: 8.9,
    },
    priceContext: {
      pair: 'USDC/BRL',
      price: 5.6,
      priceAfterDiscount: 5.58,
      discountAppliedBps: 40,
      feeFloor: 1.2,
      feePercentApplied: 2.5,
      updated_at: '2026-01-01T00:00:00Z',
    },
  })
  vi.mocked(client.cashinIntent).mockResolvedValue({
    intentId: 'App_cashin_abc',
    id: 'doc1',
    correlationID: 'App_cashin_abc',
    status: 'ACTIVE',
    valueCents: 5000,
    brCode: '000201...',
    qrCodeImage: 'https://x/qr.png',
    paymentLinkUrl: 'https://x/pay',
    expiresIn: 3600,
    splitApplied: false,
    splitValueCents: 0,
    quoteId: 'q_1',
    cryptoEstimate: 8.9,
    createdAt: '2026-01-01T00:00:00Z',
  })
  vi.mocked(client.cashinIntentStatus).mockResolvedValue({
    intentId: 'App_cashin_abc',
    correlationID: 'App_cashin_abc',
    status: 'COMPLETED',
  })
})

describe('POST /api/partner/cashin/quote', () => {
  it('rejeita sem sender', async () => {
    const res = await quotePOST(post('http://x/api/partner/cashin/quote', { amount: 50 }))
    expect(res.status).toBe(400)
    expect(client.cashinQuote).not.toHaveBeenCalled()
  })

  it('rejeita amount <= 0', async () => {
    const res = await quotePOST(
      post('http://x/api/partner/cashin/quote', { sender: SENDER, amount: 0 }),
    )
    expect(res.status).toBe(400)
    expect(client.cashinQuote).not.toHaveBeenCalled()
  })

  it('encaminha ao partnerClient e devolve a cotação', async () => {
    const res = await quotePOST(
      post('http://x/api/partner/cashin/quote', { sender: SENDER, amount: 50 }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.quoteId).toBe('q_1')
    expect(client.cashinQuote).toHaveBeenCalledWith(SENDER, expect.objectContaining({ amount: 50 }))
    // sender é só para mintar o JWT - não vai no corpo upstream.
    expect(vi.mocked(client.cashinQuote).mock.calls[0]![1]).not.toHaveProperty('sender')
  })
})

describe('POST /api/partner/cashin/intent', () => {
  const customer = { name: 'Fulano', taxID: '12345678901' }

  it('rejeita sem sender', async () => {
    const res = await intentPOST(
      post('http://x/api/partner/cashin/intent', { quoteId: 'q_1', customer }),
    )
    expect(res.status).toBe(400)
    expect(client.cashinIntent).not.toHaveBeenCalled()
  })

  it('rejeita sem quoteId e sem amount válido', async () => {
    const res = await intentPOST(
      post('http://x/api/partner/cashin/intent', { sender: SENDER, customer }),
    )
    expect(res.status).toBe(400)
    expect(client.cashinIntent).not.toHaveBeenCalled()
  })

  it('rejeita sem customer.name', async () => {
    const res = await intentPOST(
      post('http://x/api/partner/cashin/intent', {
        sender: SENDER,
        quoteId: 'q_1',
        customer: { taxID: '12345678901' },
      }),
    )
    expect(res.status).toBe(400)
    expect(client.cashinIntent).not.toHaveBeenCalled()
  })

  it('aceita sem customer.taxID (CPF/CNPJ é opcional)', async () => {
    const res = await intentPOST(
      post('http://x/api/partner/cashin/intent', {
        sender: SENDER,
        quoteId: 'q_1',
        customer: { name: 'Fulano' },
      }),
    )
    expect(res.status).toBe(201)
    expect(client.cashinIntent).toHaveBeenCalledTimes(1)
    const [, upstream] = vi.mocked(client.cashinIntent).mock.calls[0]!
    expect(upstream).toMatchObject({ quoteId: 'q_1', customer: { name: 'Fulano' } })
  })

  it('cria a cobrança (201), repassa quoteId + Idempotency-Key e não vaza sender', async () => {
    const res = await intentPOST(
      post(
        'http://x/api/partner/cashin/intent',
        { sender: SENDER, quoteId: 'q_1', customer },
        { 'Idempotency-Key': 'cashin-intent-q_1' },
      ),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.intentId).toBe('App_cashin_abc')

    expect(client.cashinIntent).toHaveBeenCalledTimes(1)
    const [pubkey, upstream, idem] = vi.mocked(client.cashinIntent).mock.calls[0]!
    expect(pubkey).toBe(SENDER)
    expect(upstream).toMatchObject({ quoteId: 'q_1', customer })
    expect(upstream).not.toHaveProperty('sender')
    expect(idem).toBe('cashin-intent-q_1')
  })
})

describe('GET /api/partner/cashin/intent/[intentId]', () => {
  const ctx = { params: Promise.resolve({ intentId: 'App_cashin_abc' }) }

  it('rejeita sem sender', async () => {
    const res = await statusGET(
      new Request('http://x/api/partner/cashin/intent/App_cashin_abc'),
      ctx,
    )
    expect(res.status).toBe(400)
    expect(client.cashinIntentStatus).not.toHaveBeenCalled()
  })

  it('encaminha (sender, intentId) e devolve o status', async () => {
    const res = await statusGET(
      new Request(`http://x/api/partner/cashin/intent/App_cashin_abc?sender=${SENDER}`),
      ctx,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe('COMPLETED')
    expect(client.cashinIntentStatus).toHaveBeenCalledWith(SENDER, 'App_cashin_abc')
  })
})
