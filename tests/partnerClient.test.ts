import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetServerEnvCache } from '@/lib/env'
import { cashinQuote, cashoutQuote } from '@/lib/partner/partnerClient'

// Exercita a montagem REAL das chamadas (sem mockar o partnerClient): stuba só o
// global.fetch e inspeciona os headers enviados. Regressão do 500 em
// cashin/quote, que ia sem os headers x-app-* exigidos pelo middleware upstream.

const ENV = {
  PARTNER_API_BASE_URL: 'https://sandbox.example.io',
  PARTNER_ID: 'partner_test',
  PARTNER_RAW_SECRET: 'raw_secret_test',
  PARTNER_APP_NAME: 'PagFinance',
  PARTNER_APP_VERSION: '9.9.9',
  PARTNER_APP_DOMAIN: 'pag.finance',
} as const

const saved: Record<string, string | undefined> = {}

/** Fila de respostas para o global.fetch stub, na ordem das chamadas. */
function stubFetch(responses: Array<Record<string, unknown>>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(init.headers ?? {})) {
        headers[k.toLowerCase()] = String(v)
      }
      calls.push({ url: String(url), headers })
      const body = responses[i++] ?? {}
      return new Response(JSON.stringify({ success: true, data: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

beforeEach(() => {
  for (const k of Object.keys(ENV)) saved[k] = process.env[k]
  Object.assign(process.env, ENV)
  __resetServerEnvCache()
})

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  __resetServerEnvCache()
  vi.unstubAllGlobals()
})

describe('cashinQuote - headers x-app-*', () => {
  it('envia x-app-* + Bearer na chamada de cotação (paridade com cashout/quote)', async () => {
    // pubkey único evita colisão com o jwtCache em memória entre os testes.
    const pubkey = 'cashin-pubkey-1'
    const calls = stubFetch([{ token: 'jwt_cashin' }, { quoteId: 'q_1' }])

    await cashinQuote(pubkey, { amount: 50 })

    const quoteCall = calls.find((c) => c.url.endsWith('/api/v1/cashin/quote'))
    expect(quoteCall).toBeDefined()
    expect(quoteCall!.headers['x-app-name']).toBe('PagFinance')
    expect(quoteCall!.headers['x-app-version']).toBe('9.9.9')
    expect(quoteCall!.headers['x-app-domain']).toBe('pag.finance')
    expect(quoteCall!.headers['authorization']).toBe('Bearer jwt_cashin')
  })

  it('provisiona a carteira (POST /users) e reemite o token quando auth/token dá 404 USER_NOT_FOUND', async () => {
    // pubkey único: o jwtCache em memória não deve curto-circuitar o mint.
    const pubkey = 'jit-pubkey-1'
    const calls: Array<{ url: string; method: string; body: string }> = []
    let tokenAttempts = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const u = String(url)
        calls.push({ url: u, method: String(init.method ?? 'GET'), body: String(init.body ?? '') })

        // 1ª tentativa de token: usuário ainda não existe → 404 USER_NOT_FOUND.
        if (u.endsWith('/api/v1/auth/token') && ++tokenAttempts === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Usuário não encontrado. Realize o cadastro antes de solicitar o token.',
              code: 'USER_NOT_FOUND',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const data = u.endsWith('/api/v1/auth/token')
          ? { token: 'jwt_after_register' }
          : u.endsWith('/api/v1/users')
            ? { uid: 'u_1', pubkey, kycStatus: 'PENDING' }
            : { quoteId: 'q_jit' }

        return new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    await cashinQuote(pubkey, { amount: 50 })

    // Registrou a carteira via HMAC POST /users, com externalUserId = pubkey.
    const registerCall = calls.find((c) => c.url.endsWith('/api/v1/users'))
    expect(registerCall).toBeDefined()
    expect(registerCall!.method).toBe('POST')
    const registerBody = JSON.parse(registerCall!.body)
    expect(registerBody.pubkey).toBe(pubkey)
    expect(registerBody.externalUserId).toBe(pubkey)

    // Chamou auth/token duas vezes (falha → registro → sucesso).
    expect(tokenAttempts).toBe(2)

    // A cotação seguiu com o Bearer reemitido após o cadastro.
    const quoteCall = calls.find((c) => c.url.endsWith('/api/v1/cashin/quote'))
    expect(quoteCall).toBeDefined()
  })

  it('cashout/quote também envia x-app-* (referência do padrão)', async () => {
    const pubkey = 'cashout-pubkey-1'
    const calls = stubFetch([{ token: 'jwt_cashout' }, { quoteId: 'q_2' }])

    await cashoutQuote(pubkey, {
      assetId: 1,
      amount: 10,
      externalId: 'ext_1',
      sender: pubkey,
      invoiceCode: 'inv_1',
    })

    const quoteCall = calls.find((c) => c.url.endsWith('/api/v1/cashout/quote'))
    expect(quoteCall).toBeDefined()
    expect(quoteCall!.headers['x-app-name']).toBe('PagFinance')
    expect(quoteCall!.headers['authorization']).toBe('Bearer jwt_cashout')
  })
})
