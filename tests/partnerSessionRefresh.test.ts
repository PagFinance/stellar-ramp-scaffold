// tests/partnerSessionRefresh.test.ts
//
// Cobre o EFEITO COLATERAL de `resolveSessionAddress`: reabrir a janela ociosa da
// sessão (`refreshSessionCookie`). É o caminho crítico da correção do cash-in - foi
// a sessão morrendo em 1h no meio do polling que deixou uma cobrança paga presa em
// "Aguardando pagamento" - e é invisível para os testes de emissão/verificação,
// que só exercitam a matemática dos dois relógios.
//
// Arquivo separado de `partnerSession.test.ts` porque `next/headers` precisa ser
// mockado no topo do módulo: fora de um request ele lança, e o `catch` de
// `refreshSessionCookie` engoliria a renovação sem que o teste percebesse.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { SESSION_COOKIE, resolveSessionAddress } from '@/lib/server/partnerSession'

const SECRET = 'test-session-secret-please-32chars'
const ADDR = 'GCEXAMPLEADDRESS7777777777777777777777777777777777777777'

const HOUR = 60 * 60
const IDLE_TTL = 1 * HOUR
const ABSOLUTE_TTL = 12 * HOUR

/** Store de cookies falso: só precisa registrar o que foi carimbado. */
const set = vi.fn()
vi.mock('next/headers', () => ({
  cookies: async () => ({ set }),
}))

/**
 * Forja um cookie de sessão com idades arbitrárias - `issueSessionToken` sempre
 * carimba `iat = agora`, então não dá para envelhecer um token por ele.
 *
 * @param ageSeconds     há quanto tempo ESTE token foi emitido (alimenta o gatilho
 *                       de renovação: metade da janela ociosa).
 * @param sessionAgeSec  há quanto tempo a carteira ASSINOU (alimenta o teto absoluto).
 */
async function forgeCookie(ageSeconds: number, sessionAgeSec = ageSeconds): Promise<Request> {
  const now = Math.floor(Date.now() / 1000)
  const iat = now - ageSeconds
  const sst = now - sessionAgeSec
  const key = new TextEncoder().encode(SECRET)
  const token = await new SignJWT({ purpose: 'partner-session', sst })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(ADDR)
    .setIssuedAt(iat)
    .setExpirationTime(Math.min(iat + IDLE_TTL, sst + ABSOLUTE_TTL))
    .sign(key)
  return new Request('https://app.test/api/partner/cashin/intent/abc', {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  })
}

describe('refreshSessionCookie (via resolveSessionAddress)', () => {
  beforeEach(() => {
    process.env.APP_SESSION_SECRET = SECRET
    set.mockClear()
  })
  afterEach(() => {
    delete process.env.APP_SESSION_SECRET
  })

  it('reabre a janela ociosa depois de metade dela gasta', async () => {
    const session = await resolveSessionAddress(await forgeCookie(45 * 60))
    expect(session?.address).toBe(ADDR)

    expect(set).toHaveBeenCalledTimes(1)
    const [name, token, opts] = set.mock.calls[0]
    expect(name).toBe(SESSION_COOKIE)
    // Uma hora inteira de novo: a janela reabriu, não foi só prorrogada.
    expect(opts.maxAge).toBe(IDLE_TTL)
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    // Token NOVO, e não o mesmo devolvido de volta.
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('NÃO reemite antes disso - o poll de 4s carimbaria Set-Cookie em toda resposta', async () => {
    const session = await resolveSessionAddress(await forgeCookie(5 * 60))
    expect(session?.address).toBe(ADDR)
    expect(set).not.toHaveBeenCalled()
  })

  it('trunca a renovação no teto absoluto em vez de empurrá-lo', async () => {
    // 11h55 de sessão, token emitido há 45min: renova, mas só pelos 5min que sobram.
    const session = await resolveSessionAddress(await forgeCookie(45 * 60, ABSOLUTE_TTL - 5 * 60))
    expect(session?.address).toBe(ADDR)

    expect(set).toHaveBeenCalledTimes(1)
    const opts = set.mock.calls[0][2]
    // Margem de 2s para o relógio andar entre a forja e a leitura.
    expect(opts.maxAge).toBeLessThanOrEqual(5 * 60)
    expect(opts.maxAge).toBeGreaterThanOrEqual(5 * 60 - 2)
  })

  it('recusa a sessão passada do teto absoluto, e não renova nada', async () => {
    const session = await resolveSessionAddress(await forgeCookie(45 * 60, 13 * HOUR))
    expect(session).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })

  it('sem cookie não há sessão nem renovação', async () => {
    const session = await resolveSessionAddress(new Request('https://app.test/api/partner/price'))
    expect(session).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })
})
