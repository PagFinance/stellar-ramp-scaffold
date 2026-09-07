// tests/partnerSession.test.ts
//
// Cobre as funções puras da sessão de parceiro (BUG-H3): emissão/verificação do
// token de sessão e o round-trip do desafio (mensagem determinística). Não
// exercita a verificação de assinatura on-chain (depende de SDKs de carteira).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import {
  sessionConfigured,
  issueSessionToken,
  verifySessionToken,
  issueChallenge,
  verifyChallenge,
} from '@/lib/server/partnerSession'

const SECRET = 'test-session-secret-please-32chars'

describe('partnerSession', () => {
  beforeEach(() => {
    process.env.APP_SESSION_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.APP_SESSION_SECRET
  })

  it('sessionConfigured reflects APP_SESSION_SECRET', () => {
    expect(sessionConfigured()).toBe(true)
    delete process.env.APP_SESSION_SECRET
    expect(sessionConfigured()).toBe(false)
  })

  it('issues and verifies a session token (round-trip)', async () => {
    const addr = 'So1anaAddress11111111111111111111111111111'
    const token = await issueSessionToken(addr)
    expect(token).toBeTruthy()
    const parsed = await verifySessionToken(token)
    expect(parsed?.address).toBe(addr)
  })

  it('rejects missing/garbage/foreign-secret tokens', async () => {
    expect(await verifySessionToken(null)).toBeNull()
    expect(await verifySessionToken('not.a.jwt')).toBeNull()

    const token = await issueSessionToken('addr-abcdefghij')
    process.env.APP_SESSION_SECRET = 'a-completely-different-secret-32c'
    expect(await verifySessionToken(token)).toBeNull()
  })

  it('returns null when not configured', async () => {
    delete process.env.APP_SESSION_SECRET
    expect(await issueSessionToken('addr-abcdefghij')).toBeNull()
    expect(await issueChallenge('addr-abcdefghij', 'solana')).toBeNull()
  })

  it('renewal keeps the original session start (sst survives, exp moves)', async () => {
    const addr = 'addr-abcdefghij'
    const now = Math.floor(Date.now() / 1000)
    const start = now - 50 * 60 // sessão assinada há 50min

    const renewed = await issueSessionToken(addr, start)
    const parsed = await verifySessionToken(renewed)
    expect(parsed?.address).toBe(addr)
    // O início não anda: é ele que alimenta o teto absoluto.
    expect(parsed?.sessionStart).toBe(start)
    // A janela ociosa reabriu: expira ~1h a partir de AGORA, não de `start`.
    expect(parsed!.expiresAt).toBeGreaterThan(now + 59 * 60)
  })

  it('refuses to renew past the absolute cap, and rejects a token beyond it', async () => {
    const addr = 'addr-abcdefghij'
    const now = Math.floor(Date.now() / 1000)

    // 13h de sessão: passou do teto de 12h, então não há o que reemitir.
    expect(await issueSessionToken(addr, now - 13 * 60 * 60)).toBeNull()

    // Um token emitido dentro do teto deixa de valer quando o teto passa, mesmo
    // com o exp ainda no futuro. Emitido a 11h59 de vida, expira 1min depois.
    const nearCap = await issueSessionToken(addr, now - (12 * 60 * 60 - 60))
    expect(nearCap).toBeTruthy()
    const parsed = await verifySessionToken(nearCap)
    expect(parsed?.expiresAt).toBe(now + 60)
  })

  it('accepts a legacy token with no sst (session start falls back to iat)', async () => {
    const addr = 'addr-abcdefghij'
    const now = Math.floor(Date.now() / 1000)
    const key = new TextEncoder().encode(SECRET)
    // Formato anterior à renovação deslizante: sem `sst`.
    const legacy = await new SignJWT({ purpose: 'partner-session' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(addr)
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 60)
      .sign(key)

    const parsed = await verifySessionToken(legacy)
    expect(parsed?.address).toBe(addr)
    expect(parsed?.sessionStart).toBe(now)
  })

  it('challenge round-trip recomputes the exact signed message', async () => {
    const addr = 'rXRPLAddress9999999999999999999'
    const chain = 'xrpl'
    const challenge = await issueChallenge(addr, chain)
    expect(challenge?.challengeToken).toBeTruthy()
    expect(challenge?.message).toContain(`address:${addr}`)

    const recomputed = await verifyChallenge(challenge!.challengeToken, addr, chain)
    expect(recomputed).toBe(challenge!.message)
  })

  it('challenge verify rejects address/chain mismatch and garbage', async () => {
    const challenge = await issueChallenge('addr-abcdefghij', 'solana')
    expect(await verifyChallenge(challenge!.challengeToken, 'other-addr-xyz', 'solana')).toBeNull()
    expect(await verifyChallenge(challenge!.challengeToken, 'addr-abcdefghij', 'evm')).toBeNull()
    expect(await verifyChallenge('garbage', 'addr-abcdefghij', 'solana')).toBeNull()
  })
})
