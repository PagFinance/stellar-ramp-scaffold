// lib/env.ts
//
// Validação de variáveis de ambiente com zod. Fornece acessores tipados e
// validados para as variáveis server-only usadas pelos endpoints internos do Next.
//
// Uso: `getServerEnv()` (server-only) - memoizado; lança um erro agregado e
// legível na primeira chamada se a configuração for inválida (falha cedo, em vez
// de quebrar no meio de um fluxo). Os helpers `boolEnv`/`assertEnv` seguem
// disponíveis por compatibilidade.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Helpers legados (compatibilidade)
// ---------------------------------------------------------------------------
export function boolEnv(name: string, def = false) {
  const v = process.env[name]
  if (v == null) return def
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
}

export function assertEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Env ${name} ausente`)
  return v
}

// ---------------------------------------------------------------------------
// Schema server-only
// ---------------------------------------------------------------------------
const serverSchema = z.object({
  // Segredo HS256 para o token de sessão de carteira (prova-de-posse Stellar).
  // Opcional em dev (cai no modo legado com aviso); recomendado em produção.
  APP_SESSION_SECRET: z.string().min(16).optional(),

  // ── PagFinance Partner API (server-only) ─────────────────────────────────
  // Credenciais de integração com a partner-api (cash-in / cash-out / preços).
  // O segredo HMAC NUNCA vai ao browser - só as rotas app/api/partner/* usam.
  // Todas opcionais: sem elas, getServerEnv() não quebra; o partnerClient é que
  // responde "não configurada" (503) quando alguma falta.
  PARTNER_API_BASE_URL: z.string().url().optional(),
  PARTNER_ID: z.string().optional(),
  PARTNER_RAW_SECRET: z.string().optional(),
  PARTNER_APP_NAME: z.string().optional(),
  PARTNER_APP_VERSION: z.string().optional(),
  PARTNER_APP_DOMAIN: z.string().optional(),
  // TTL (segundos) do JWT que o parceiro solicita ao mintar por usuário.
  PARTNER_JWT_TTL_SECONDS: z.coerce.number().int().positive().optional(),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cachedServerEnv: ServerEnv | null = null

/**
 * Retorna o env server validado (memoizado). Lança um erro agregado legível se
 * inválido. Deve ser chamado apenas em código server.
 */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Configuração de ambiente inválida:\n${issues}`)
  }
  cachedServerEnv = parsed.data
  return cachedServerEnv
}

/** Apenas para testes: limpa o cache do env validado. */
export function __resetServerEnvCache() {
  cachedServerEnv = null
}

/**
 * Preflight de PRODUÇÃO - falha ALTO no boot quando segredos obrigatórios faltam.
 * Chamado uma vez em `instrumentation.ts#register()`.
 *
 * Motivação (NEW-H1 / BUG-H3): `APP_SESSION_SECRET` é opcional para o demo local,
 * mas sem ele `requireSender` cai no modo legado que CONFIA no `sender` enviado
 * pelo cliente - abrindo IDOR em todas as rotas de dinheiro. Um fork que suba em
 * produção sem o segredo herdaria essa brecha silenciosamente (só um console.warn).
 * Preferimos derrubar o boot a servir rotas de dinheiro abertas.
 */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return

  const errors: string[] = []
  const secret = process.env.APP_SESSION_SECRET
  if (!secret || secret.length < 16) {
    errors.push(
      'APP_SESSION_SECRET ausente ou com menos de 16 chars. Em produção ele é ' +
        'OBRIGATÓRIO: sem ele as rotas de cash-in/out confiam no `sender` do ' +
        'cliente (IDOR - BUG-H3). Gere um segredo forte e defina no ambiente.',
    )
  }

  if (errors.length) {
    throw new Error(
      `[preflight] Configuração de produção inválida:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// PagFinance Partner API - config derivada (server-only)
// ---------------------------------------------------------------------------

export interface PartnerConfig {
  /** Base URL da partner-api (sem barra final), ex.: https://sandbox.brlp.io */
  baseUrl: string
  partnerId: string
  rawSecret: string
  /** TTL (em segundos) solicitado ao mintar o JWT do usuário. */
  jwtTtlSeconds?: number
  /** Headers obrigatórios de POST /cashout/quote. */
  appHeaders: {
    'x-app-name': string
    'x-app-version': string
    'x-app-domain': string
  }
  /** true quando baseUrl + partnerId + rawSecret estão todos presentes. */
  configured: boolean
}

/**
 * Retorna a configuração da partner-api a partir do env validado.
 * `configured=false` quando qualquer credencial essencial falta - nesse caso o
 * partnerClient lança PARTNER_NOT_CONFIGURED e as rotas respondem 503.
 */
export function getPartnerConfig(): PartnerConfig {
  const env = getServerEnv()
  const baseUrl = (env.PARTNER_API_BASE_URL ?? '').replace(/\/+$/, '')
  // `.trim()` no partnerId e no rawSecret: espaço/newline sobrando no valor da
  // env (copiar/colar em `.env` ou no secret store, terminal que adiciona `\n`)
  // altera o `SHA256(rawSecret + ":" + partnerId)` e derruba 100% das assinaturas
  // HMAC com um genérico 401 "Assinatura HMAC inválida" - impossível de diagnosticar
  // sem inspecionar os bytes. O secret provisionado é hex puro e o partnerId é um
  // slug; nenhum contém espaço legítimo nas bordas, então trimar é seguro.
  const partnerId = (env.PARTNER_ID ?? '').trim()
  const rawSecret = (env.PARTNER_RAW_SECRET ?? '').trim()

  return {
    baseUrl,
    partnerId,
    rawSecret,
    jwtTtlSeconds: env.PARTNER_JWT_TTL_SECONDS,
    appHeaders: {
      'x-app-name': env.PARTNER_APP_NAME ?? 'PagFinance',
      'x-app-version': env.PARTNER_APP_VERSION ?? '1.0.0',
      'x-app-domain': env.PARTNER_APP_DOMAIN ?? 'pag.finance',
    },
    configured: Boolean(baseUrl && partnerId && rawSecret),
  }
}
