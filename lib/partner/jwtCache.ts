// lib/partner/jwtCache.ts
//
// Cache in-memory (por instância) dos JWTs de usuário emitidos pela partner-api.
// Mesmo padrão de lib/server/rateLimit.ts (globalThis-backed).
//
// ⚠️ Scaffold: in-memory não serve para multi-instância. TODO(produção): trocar
// por Redis/KV compartilhado. Ok para o scaffold de referência.
import 'server-only'

interface CachedJwt {
  token: string
  /** epoch em ms de expiração (com margem de segurança já aplicada). */
  expMs: number
}

const g = globalThis as unknown as {
  __partnerJwtCache?: Map<string, CachedJwt>
}
if (!g.__partnerJwtCache) g.__partnerJwtCache = new Map()
const cache = g.__partnerJwtCache

/** Margem de segurança: renova 30s antes de expirar de fato. */
const SAFETY_MARGIN_MS = 30_000

/** Retorna um JWT válido em cache para o pubkey, ou null. */
export function getCachedJwt(pubkey: string, now: number = Date.now()): string | null {
  const entry = cache.get(pubkey)
  if (!entry) return null
  if (entry.expMs <= now) {
    cache.delete(pubkey)
    return null
  }
  return entry.token
}

/**
 * Guarda um JWT. `expiresInSeconds` é o TTL informado pela API (ex.: derivado de
 * "7d" ou de um número). Fallback conservador de 5min quando desconhecido.
 */
export function setCachedJwt(
  pubkey: string,
  token: string,
  expiresInSeconds: number | undefined,
  now: number = Date.now(),
): void {
  const ttlMs = (expiresInSeconds && expiresInSeconds > 0 ? expiresInSeconds : 300) * 1000
  cache.set(pubkey, { token, expMs: now + ttlMs - SAFETY_MARGIN_MS })
}

/** Apenas para testes. */
export function __resetJwtCache() {
  cache.clear()
}
