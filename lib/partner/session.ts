// lib/partner/session.ts
//
// Cliente de browser para a sessão de carteira (/api/partner/session*). Faz o
// "login" de prova-de-posse: pega um desafio, assina com a carteira ativa e
// troca pelo cookie httpOnly de sessão. As rotas de cash-in/out passam a derivar
// o `sender` dessa sessão (fecha o BUG-H3). Same-origin → o cookie vai/volta
// automaticamente; não há token exposto ao JS.

import type { SignatureResult } from '@/lib/types/WalletSlice'

export interface PartnerSessionState {
  configured: boolean
  address: string | null
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

/** Estado atual da sessão (do cookie). */
export async function getPartnerSession(): Promise<PartnerSessionState> {
  const res = await fetch('/api/partner/session', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const json = await readJson(res)
  const data = json?.data ?? json
  return { configured: Boolean(data?.configured), address: data?.address ?? null }
}

/** Encerra a sessão (logout). */
export async function endPartnerSession(): Promise<void> {
  await fetch('/api/partner/session', { method: 'DELETE' }).catch(() => {})
}

export interface EstablishResult {
  ok: boolean
  /** true quando o backend não exige sessão (dev, sem APP_SESSION_SECRET). */
  skipped?: boolean
  error?: string
}

/**
 * Estabelece a sessão: desafio → assinatura → cookie. `signMessage` é o da
 * carteira Stellar ativa (o address `G…` já é a chave pública Ed25519).
 */
export async function establishPartnerSession(opts: {
  address: string
  blockchain: string
  publicKey?: string | null
  signMessage: (message: string) => Promise<SignatureResult | void>
}): Promise<EstablishResult> {
  // 1. desafio
  const qs = new URLSearchParams({ address: opts.address, blockchain: opts.blockchain }).toString()
  const chRes = await fetch(`/api/partner/session/challenge?${qs}`, {
    headers: { Accept: 'application/json' },
  })
  const chJson = await readJson(chRes)
  const ch = chJson?.data ?? chJson
  if (ch?.configured === false) return { ok: true, skipped: true } // dev
  if (!chRes.ok) return { ok: false, error: chJson?.error ?? `Falha no desafio (${chRes.status}).` }
  if (!ch?.challengeToken || !ch?.message) return { ok: false, error: 'Desafio inválido.' }

  // 2. assina a mensagem do desafio com a carteira ativa
  let sig: SignatureResult | void
  try {
    sig = await opts.signMessage(ch.message)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Assinatura recusada.' }
  }
  const signature =
    (sig && typeof sig === 'object' ? (sig.signature ?? null) : null) ??
    // fallback: alguns backends devolvem { result: { signedMessage } }
    (sig as any)?.result?.signedMessage ??
    null
  if (!signature) return { ok: false, error: 'Assinatura não obtida da carteira.' }

  // publicKey: usa o da assinatura quando presente, senão o passado.
  const publicKey =
    (sig && typeof sig === 'object' ? (sig.publicKey ?? null) : null) ?? opts.publicKey ?? null

  // 3. troca pela sessão (grava o cookie)
  const res = await fetch('/api/partner/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      address: opts.address,
      blockchain: opts.blockchain,
      publicKey,
      signature,
      challengeToken: ch.challengeToken,
    }),
  })
  const json = await readJson(res)
  const data = json?.data ?? json
  if (!res.ok || !data?.ok) {
    return { ok: false, error: json?.error ?? `Falha no login (${res.status}).` }
  }
  return { ok: true }
}
