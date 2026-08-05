// lib/server/rateLimit.ts
//
// Rate-limit simples por chave (ex.: IP), janela fixa, in-memory.
// ⚠️ Scaffold: in-memory não serve para multi-instância. TODO(produção):
// trocar por Redis/KV (mesma interface).

const g = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, { count: number; resetAt: number }>
}
if (!g.__rateLimitBuckets) g.__rateLimitBuckets = new Map()
const buckets = g.__rateLimitBuckets

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number }

/**
 * Consome 1 do orçamento de `key`. Retorna ok=false quando estoura o limite na
 * janela. `now` é injetável para testes.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { ok: true, remaining: limit - 1, resetAt }
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt }
  }
  b.count += 1
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt }
}

/**
 * Extrai um identificador de cliente (IP) resistente a spoof de `X-Forwarded-For`.
 *
 * O XFF é uma lista "client, proxy1, proxy2, …" anexada da esquerda p/ a direita;
 * a entrada MAIS À ESQUERDA é totalmente controlada pelo cliente. Usá-la (como
 * antes) permite rotacionar o header e obter um bucket novo a cada request,
 * anulando o rate-limit - a única defesa das rotas anônimas (BUG-M1).
 *
 * Estratégia:
 *  1. Se `TRUSTED_CLIENT_IP_HEADER` estiver definido (ex.: `cf-connecting-ip`,
 *     `x-vercel-forwarded-for`, ou o header de IP da sua borda), ele é autoritativo.
 *  2. Senão, usa a entrada do XFF adicionada pelo hop confiável mais próximo - a
 *     (`TRUSTED_PROXY_COUNT`)-ésima a partir da direita (default 1 = a mais à direita).
 *  3. Fallback: `x-real-ip`.
 *
 * ⚠️ Configure `TRUSTED_PROXY_COUNT`/`TRUSTED_CLIENT_IP_HEADER` conforme sua
 * infra e garanta que a borda REESCREVE (não apenas anexa) o XFF de entrada.
 */
export function clientIp(req: Request): string {
  const trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER
  if (trustedHeader) {
    const v = req.headers.get(trustedHeader)
    if (v) return v.split(',')[0]!.trim()
  }

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const trustedProxies = Math.max(1, Number(process.env.TRUSTED_PROXY_COUNT ?? '1') || 1)
    // Só confie no XFF se ele for pelo menos tão longo quanto o nº de proxies
    // confiáveis. Se for MAIS CURTO (misconfig: TRUSTED_PROXY_COUNT alto demais, ou
    // um hop removido), NÃO caia no valor mais à esquerda (spoofável) - isso
    // reabriria o BUG-M1. Falha seguro: usa x-real-ip.
    if (parts.length >= trustedProxies) {
      return parts[parts.length - trustedProxies]!
    }
    console.warn(
      `[rateLimit] X-Forwarded-For tem ${parts.length} hop(s) < TRUSTED_PROXY_COUNT=${trustedProxies}; ignorando XFF (possível misconfig).`,
    )
  }

  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Apenas para testes. */
export function __resetRateLimit() {
  buckets.clear()
}
