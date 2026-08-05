import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rateLimit, clientIp, __resetRateLimit } from '@/lib/server/rateLimit'

describe('rateLimit', () => {
  beforeEach(() => __resetRateLimit())

  it('permite até o limite e bloqueia o excedente na janela', () => {
    const key = 'ip:1'
    const t0 = 1000
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true)
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true)
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true)
    const blocked = rateLimit(key, 3, 1000, t0)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('reseta após a janela', () => {
    const key = 'ip:2'
    expect(rateLimit(key, 1, 1000, 0).ok).toBe(true)
    expect(rateLimit(key, 1, 1000, 500).ok).toBe(false) // ainda na janela
    expect(rateLimit(key, 1, 1000, 1001).ok).toBe(true) // janela expirou
  })

  it('chaves diferentes têm orçamentos independentes', () => {
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('b', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(false)
  })
})

describe('clientIp (anti-spoof X-Forwarded-For - BUG-M1)', () => {
  afterEach(() => {
    delete process.env.TRUSTED_CLIENT_IP_HEADER
    delete process.env.TRUSTED_PROXY_COUNT
  })

  it('usa a entrada mais à direita do XFF por padrão (hop confiável), não a spoofável à esquerda', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': 'evil-spoof, 203.0.113.7' },
    })
    expect(clientIp(req)).toBe('203.0.113.7')
  })

  it('respeita TRUSTED_PROXY_COUNT para escolher o hop', () => {
    process.env.TRUSTED_PROXY_COUNT = '2'
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 10.0.0.1' },
    })
    // 2 proxies confiáveis → pega a 2ª a partir da direita
    expect(clientIp(req)).toBe('203.0.113.7')
  })

  it('TRUSTED_CLIENT_IP_HEADER, quando definido, é autoritativo', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip'
    const req = new Request('http://x', {
      headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': 'evil' },
    })
    expect(clientIp(req)).toBe('198.51.100.9')
  })

  it('cai para x-real-ip quando não há XFF', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '192.0.2.5' } })
    expect(clientIp(req)).toBe('192.0.2.5')
  })

  it('fail-safe: XFF mais curto que TRUSTED_PROXY_COUNT NÃO cai no valor spoofável', () => {
    // Misconfig: 3 proxies confiáveis declarados, mas o XFF tem 1 só (spoofável).
    process.env.TRUSTED_PROXY_COUNT = '3'
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': 'evil-spoof', 'x-real-ip': '192.0.2.9' },
    })
    // Não deve retornar 'evil-spoof' (leftmost) - ignora o XFF e usa x-real-ip.
    expect(clientIp(req)).toBe('192.0.2.9')
  })
})
