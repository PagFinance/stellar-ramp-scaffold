// lib/server/partnerSession.ts
//
// SERVER-ONLY. Sessão de parceiro com prova-de-posse da carteira (fecha o
// BUG-H3 / IDOR). O fluxo:
//
//   1. GET  /api/partner/session/challenge → { challengeToken, message }
//      (challengeToken é um JWT HS256 curto - nonce+address+chain+exp).
//   2. a carteira ativa ASSINA `message` (signMessage).
//   3. POST /api/partner/session { address, blockchain, publicKey?, signature,
//      challengeToken } → verifica o desafio + a assinatura on-chain e emite um
//      cookie httpOnly de sessão (JWT HS256, sub=address).
//   4. as rotas de cash-in/out derivam o `sender` DESSA sessão verificada, nunca
//      de um campo do body/query controlado pelo cliente.
//   5. cada leitura de sessão reabre a janela ociosa (`resolveSessionAddress` →
//      `refreshSessionCookie`), até o teto absoluto contado da assinatura. Passado
//      o teto, o passo 1 recomeça.
//
// Sem APP_SESSION_SECRET (ex.: dev), a sessão fica "não configurada": o desafio
// vira no-op e as rotas caem no sender do cliente com aviso (comportamento
// legado, para não travar o demo). Em produção, defina o segredo para habilitar
// o modo seguro.

import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'
import { verifyStellarSignature } from '@/lib/chains/stellar/verifySignature'

export const SESSION_COOKIE = 'pf_partner_session'
// Dois prazos, e os dois fazem falta:
//
//   IDLE     janela deslizante, reaberta a cada request autenticado. Era o único
//            prazo até aqui, e SEM renovação: a sessão morria 1h depois da
//            assinatura mesmo com a aba em uso, no meio do polling do cash-in, e
//            o front só descobria pelo 401.
//   ABSOLUTE teto contado da ASSINATURA, que nenhuma renovação move. Sem ele o
//            deslizamento vira sessão eterna: o polling bate a cada 4s, então a
//            janela nunca fecharia sozinha e um cookie roubado se renovaria para
//            sempre. A prova de posse tem de ser refeita de tempos em tempos.
const SESSION_IDLE_TTL_SECONDS = 60 * 60 // 1h sem uso
const SESSION_ABSOLUTE_TTL_SECONDS = 12 * 60 * 60 // 12h desde a assinatura
// Só reemite depois que o token gastou metade da janela ociosa.
const SESSION_REFRESH_AFTER_SECONDS = SESSION_IDLE_TTL_SECONDS / 2
const CHALLENGE_TTL_SECONDS = 5 * 60 // 5min
const SESSION_PURPOSE = 'partner-session'
const CHALLENGE_PURPOSE = 'partner-challenge'

function secretKey(): Uint8Array | null {
  const s = process.env.APP_SESSION_SECRET
  if (!s || s.length < 16) return null
  return new TextEncoder().encode(s)
}

/** true quando APP_SESSION_SECRET está configurado (modo seguro). */
export function sessionConfigured(): boolean {
  return secretKey() !== null
}

// ── Mensagem de desafio (determinística) ─────────────────────────────────────

function buildChallengeMessage(address: string, chain: string, nonce: string, iat: number): string {
  return [
    'PagFinance - autenticação de carteira',
    'Assine para provar a posse desta carteira. Isto não gera custo nem transação.',
    `address:${address}`,
    `chain:${chain}`,
    `nonce:${nonce}`,
    `iat:${iat}`,
  ].join('\n')
}

export interface ChallengeIssue {
  challengeToken: string
  message: string
}

/** Emite um desafio assinado (stateless). Retorna null se não configurado. */
export async function issueChallenge(
  address: string,
  chain: string,
): Promise<ChallengeIssue | null> {
  const key = secretKey()
  if (!key) return null

  const nonce = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const challengeToken = await new SignJWT({ chain, purpose: CHALLENGE_PURPOSE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(address)
    .setJti(nonce)
    .setIssuedAt(now)
    .setExpirationTime(now + CHALLENGE_TTL_SECONDS)
    .sign(key)

  return { challengeToken, message: buildChallengeMessage(address, chain, nonce, now) }
}

/**
 * Verifica o challengeToken e recompõe a mensagem que deveria ter sido assinada.
 * Retorna a mensagem canônica (para conferir a assinatura) ou null.
 */
export async function verifyChallenge(
  challengeToken: string,
  address: string,
  chain: string,
): Promise<string | null> {
  const key = secretKey()
  if (!key || !challengeToken) return null
  try {
    const { payload } = await jwtVerify(challengeToken, key)
    if (payload.purpose !== CHALLENGE_PURPOSE) return null
    if (payload.sub !== address) return null
    if (payload.chain !== chain) return null
    const nonce = String(payload.jti ?? '')
    const iat = Number(payload.iat ?? 0)
    if (!nonce || !iat) return null
    return buildChallengeMessage(address, chain, nonce, iat)
  } catch {
    return null
  }
}

// ── Verificação da assinatura on-chain ───────────────────────────────────────

/** Verifica a assinatura da `message` pela carteira `address` (Stellar). */
export async function verifyWalletSignature(opts: {
  blockchain: string
  address: string
  publicKey?: string | null
  message: string
  signature: string
}): Promise<boolean> {
  const chain = (opts.blockchain ?? '').toLowerCase()

  if (chain === 'stellar' || chain === 'xlm') {
    // No Stellar o próprio address (`G...`) é a chave pública Ed25519, então não
    // é preciso um `publicKey` separado - a chave é derivada do address.
    const r = verifyStellarSignature({
      message: opts.message,
      signature: opts.signature,
      address: opts.address,
    })
    return r.valid === true
  }

  return false
}

// ── Cookie de sessão (JWT HS256, sub=address) ────────────────────────────────

export interface VerifiedSession {
  address: string
  /** Epoch (s) da ASSINATURA original. Não se move nas renovações. */
  sessionStart: number
  /** Epoch (s) em que ESTE token foi emitido (muda a cada renovação). */
  issuedAt: number
  /** Epoch (s) em que este token expira. */
  expiresAt: number
}

/** Fim desta sessão: o que vencer primeiro, a janela ociosa ou o teto absoluto. */
function sessionExpiry(sessionStart: number, now: number): number {
  return Math.min(now + SESSION_IDLE_TTL_SECONDS, sessionStart + SESSION_ABSOLUTE_TTL_SECONDS)
}

/**
 * Emite o token de sessão (para gravar no cookie). null se não configurado, ou
 * se a sessão já passou do teto absoluto.
 *
 * `sessionStart` só é passado na RENOVAÇÃO, para preservar o instante da
 * assinatura original. Omitido, esta é uma sessão nova e o relógio começa agora.
 */
export async function issueSessionToken(
  address: string,
  sessionStart?: number,
): Promise<string | null> {
  const key = secretKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  const start = sessionStart ?? now
  const exp = sessionExpiry(start, now)
  if (exp <= now) return null
  return new SignJWT({ purpose: SESSION_PURPOSE, sst: start })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(address)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)
}

export const SESSION_MAX_AGE = SESSION_IDLE_TTL_SECONDS

/** Verifica um token de sessão. Retorna a sessão verificada ou null. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<VerifiedSession | null> {
  const key = secretKey()
  if (!key || !token) return null
  try {
    const { payload } = await jwtVerify(token, key)
    if (payload.purpose !== SESSION_PURPOSE) return null
    if (!payload.sub) return null
    // `sst` não existia antes da renovação deslizante; nesses tokens o início da
    // sessão É o `iat`, então eles continuam valendo até o próprio exp em vez de
    // serem invalidados em bloco no deploy.
    const sessionStart = Number(payload.sst ?? payload.iat ?? 0)
    const issuedAt = Number(payload.iat ?? 0)
    const expiresAt = Number(payload.exp ?? 0)
    if (!sessionStart || !issuedAt || !expiresAt) return null
    // Teto absoluto conferido aqui também, e não só no exp emitido: é o limite que
    // nenhuma renovação pode empurrar, e checá-lo na verificação significa que um
    // token forjado com exp generoso (se a chave vazar) ainda esbarra nele.
    const now = Math.floor(Date.now() / 1000)
    if (now >= sessionStart + SESSION_ABSOLUTE_TTL_SECONDS) return null
    return { address: String(payload.sub), sessionStart, issuedAt, expiresAt }
  } catch {
    return null
  }
}

/** Opções do cookie de sessão. Fonte única: emissão e renovação não podem divergir. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

/**
 * Reabre a janela ociosa da sessão, se já valeu a pena. Chamado a cada leitura de
 * sessão, então roda em toda rota autenticada sem que nenhuma delas saiba disso.
 *
 * Não reemite a cada request de propósito: o polling do cash-in bate a cada 4s e
 * carimbaria um Set-Cookie em toda resposta. Só reemite depois que o token gastou
 * metade da janela, o que dá no máximo um Set-Cookie a cada 30 min por sessão.
 */
async function refreshSessionCookie(session: VerifiedSession): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  if (now - session.issuedAt < SESSION_REFRESH_AFTER_SECONDS) return
  const exp = sessionExpiry(session.sessionStart, now)
  if (exp <= now) return // no teto absoluto: deixa vencer, reassinatura é o caminho
  const token = await issueSessionToken(session.address, session.sessionStart)
  if (!token) return
  try {
    // Import dinâmico: `next/headers` só existe dentro de um request. Fora dele
    // (vitest, prerender) não há resposta para carimbar, e a sessão atual segue
    // válida, apenas sem deslizar desta vez.
    const { cookies } = await import('next/headers')
    const store = await cookies()
    store.set(SESSION_COOKIE, token, sessionCookieOptions(exp - now))
  } catch {
    // Sem contexto de request, ou resposta já enviada. Nunca fatal.
  }
}

/** Lê um cookie do header `Cookie` da request. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim())
    }
  }
  return null
}

/**
 * Address da sessão atual (a partir do cookie), ou null. Efeito colateral
 * deliberado: reabre a janela ociosa da sessão. Este é o único ponto por onde
 * TODA leitura de sessão passa (requireSender, requireSession, requireKycIdentity),
 * então renovar aqui cobre as 11 rotas autenticadas sem tocar em nenhuma delas.
 */
export async function resolveSessionAddress(req: Request): Promise<{ address: string } | null> {
  const session = await verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!session) return null
  await refreshSessionCookie(session)
  return { address: session.address }
}
