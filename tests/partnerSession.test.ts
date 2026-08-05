// tests/partnerSession.test.ts
//
// Cobre as funções puras da sessão de parceiro (BUG-H3): emissão/verificação do
// token de sessão e o round-trip do desafio (mensagem determinística). Não
// exercita a verificação de assinatura on-chain (depende de SDKs de carteira).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
