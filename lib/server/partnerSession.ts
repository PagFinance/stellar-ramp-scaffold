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
const SESSION_TTL_SECONDS = 60 * 60 // 1h
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

/** Emite o token de sessão (para gravar no cookie). null se não configurado. */
export async function issueSessionToken(address: string): Promise<string | null> {
  const key = secretKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ purpose: SESSION_PURPOSE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(address)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(key)
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS

/** Verifica um token de sessão. Retorna o address (sub) ou null. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<{ address: string } | null> {
  const key = secretKey()
  if (!key || !token) return null
  try {
    const { payload } = await jwtVerify(token, key)
    if (payload.purpose !== SESSION_PURPOSE) return null
    if (!payload.sub) return null
    return { address: String(payload.sub) }
  } catch {
    return null
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

/** Address da sessão atual (a partir do cookie), ou null. */
export async function resolveSessionAddress(req: Request): Promise<{ address: string } | null> {
  return verifySessionToken(readCookie(req, SESSION_COOKIE))
}
