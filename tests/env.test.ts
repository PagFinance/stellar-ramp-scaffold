import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getServerEnv,
  getPartnerConfig,
  assertProductionEnv,
  __resetServerEnvCache,
} from '@/lib/env'

const KEYS = ['XUMM_API_KEY', 'XUMM_API_SECRET', 'APP_SESSION_SECRET'] as const

describe('getServerEnv (zod)', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    for (const k of KEYS) delete process.env[k]
    __resetServerEnvCache()
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    __resetServerEnvCache()
  })

  it('passes when optional vars are absent', () => {
    expect(() => getServerEnv()).not.toThrow()
    expect(getServerEnv().APP_SESSION_SECRET).toBeUndefined()
  })

  it('accepts a valid APP_SESSION_SECRET (>= 16 chars)', () => {
    process.env.APP_SESSION_SECRET = 'a-very-long-session-secret'
    __resetServerEnvCache()
    expect(() => getServerEnv()).not.toThrow()
    expect(getServerEnv().APP_SESSION_SECRET).toBe('a-very-long-session-secret')
  })

  it('rejects a too-short APP_SESSION_SECRET', () => {
    process.env.APP_SESSION_SECRET = 'short'
    __resetServerEnvCache()
    expect(() => getServerEnv()).toThrow(/APP_SESSION_SECRET/)
  })
})

describe('getPartnerConfig (HMAC identity)', () => {
  const PKEYS = ['PARTNER_API_BASE_URL', 'PARTNER_ID', 'PARTNER_RAW_SECRET'] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of PKEYS) saved[k] = process.env[k]
    __resetServerEnvCache()
  })

  afterEach(() => {
    for (const k of PKEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    __resetServerEnvCache()
  })

  // Regressão: espaço/newline sobrando na env do secret ou do partnerId muda o
  // SHA256(rawSecret + ":" + partnerId) e derruba 100% das assinaturas HMAC com um
  // 401 "Assinatura HMAC inválida". getPartnerConfig deve trimar as bordas.
  it('trims surrounding whitespace/newline from partnerId and rawSecret', () => {
    process.env.PARTNER_API_BASE_URL = 'https://sandbox.brlp.io/'
    process.env.PARTNER_ID = '  replycash\n'
    process.env.PARTNER_RAW_SECRET = '\tdeadbeef0123  '
    __resetServerEnvCache()

    const cfg = getPartnerConfig()
    expect(cfg.partnerId).toBe('replycash')
    expect(cfg.rawSecret).toBe('deadbeef0123')
    expect(cfg.baseUrl).toBe('https://sandbox.brlp.io') // barra final removida
    expect(cfg.configured).toBe(true)
  })

  it('is not configured when a credential is missing', () => {
    delete process.env.PARTNER_API_BASE_URL
    delete process.env.PARTNER_ID
    delete process.env.PARTNER_RAW_SECRET
    __resetServerEnvCache()
    expect(getPartnerConfig().configured).toBe(false)
  })
})

describe('assertProductionEnv (preflight fail-closed - NEW-H1)', () => {
  const savedNodeEnv = process.env.NODE_ENV
  const savedSecret = process.env.APP_SESSION_SECRET

  afterEach(() => {
    // NODE_ENV é readonly no type do Node; setamos via cast só no teste.
    ;(process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv
    if (savedSecret === undefined) delete process.env.APP_SESSION_SECRET
    else process.env.APP_SESSION_SECRET = savedSecret
  })

  it('não faz nada fora de produção', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    delete process.env.APP_SESSION_SECRET
    expect(() => assertProductionEnv()).not.toThrow()
  })

  it('derruba o boot em produção sem APP_SESSION_SECRET', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    delete process.env.APP_SESSION_SECRET
    expect(() => assertProductionEnv()).toThrow(/APP_SESSION_SECRET/)
  })

  it('passa em produção com um segredo válido', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    process.env.APP_SESSION_SECRET = 'a-very-long-session-secret'
    expect(() => assertProductionEnv()).not.toThrow()
  })
})
