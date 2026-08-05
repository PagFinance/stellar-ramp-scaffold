// lib/chains/stellar/verifySignature.ts
//
// Verificação da prova-de-posse Stellar (mensagem assinada pela carteira via
// Stellar Wallets Kit). O address Stellar (`G...`) JÁ É a chave pública Ed25519
// codificada em StrKey, então a chave é derivada do próprio address - não é
// preciso um `publicKey` separado.
//
// O ecossistema Stellar ainda não convergiu num único formato de "sign message":
// a maioria das carteiras (Freighter incl.) assina os bytes UTF-8 crus da
// mensagem; carteiras alinhadas ao SEP-53 assinam o SHA-256 de um prefixo +
// mensagem. Tentamos os dois payloads determinísticos; qualquer assinatura
// válida da chave real sobre um deles comprova a posse. Nada aqui torna a
// verificação mais fraca: cada payload é uma função fixa da mensagem conhecida.

import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { createHash } from 'node:crypto'

export type VerifyStellarSignatureInput = {
  message: string
  signature: string // base64 (padrão do Stellar Wallets Kit), base64url ou hex
  address: string // chave pública Ed25519 em StrKey (`G...`)
}

export type VerifyStellarSignatureResult = { valid: true } | { valid: false; reason: string }

// Prefixo SEP-53 (message signing). Mantido como candidato secundário.
const SEP53_PREFIX = 'Stellar Signed Message:\n'

/** Normaliza a assinatura (base64 / base64url / hex) para 64 bytes Ed25519. */
function toSignatureBytes(sig: string): Buffer | null {
  const clean = sig.trim()

  // hex (com ou sem 0x)
  const hexCandidate = clean.replace(/^0x/, '')
  if (/^[0-9a-fA-F]+$/.test(hexCandidate) && hexCandidate.length % 2 === 0) {
    const buf = Buffer.from(hexCandidate, 'hex')
    if (buf.length === 64) return buf
  }

  // base64 e base64url
  for (const variant of [clean, clean.replace(/-/g, '+').replace(/_/g, '/')]) {
    try {
      const buf = Buffer.from(variant, 'base64')
      if (buf.length === 64) return buf
    } catch {
      // ignora e tenta o próximo formato
    }
  }

  return null
}

export function verifyStellarSignature(
  input: VerifyStellarSignatureInput,
): VerifyStellarSignatureResult {
  const { message, signature, address } = input

  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return { valid: false, reason: 'Endereço Stellar inválido.' }
  }

  const sigBytes = toSignatureBytes(signature)
  if (!sigBytes) {
    return { valid: false, reason: 'Assinatura Stellar em formato desconhecido.' }
  }

  const keypair = Keypair.fromPublicKey(address)

  // Candidatos de payload assinado (ver nota no topo do arquivo):
  //  1. bytes UTF-8 crus da mensagem (maioria das carteiras / Freighter)
  //  2. SHA-256 do prefixo SEP-53 + mensagem (carteiras alinhadas ao SEP-53)
  const rawPayload = Buffer.from(message, 'utf8')
  const sep53Payload = createHash('sha256').update(SEP53_PREFIX).update(message, 'utf8').digest()

  for (const payload of [rawPayload, sep53Payload]) {
    try {
      if (keypair.verify(payload, sigBytes)) return { valid: true }
    } catch {
      // assinatura malformada para esse payload - tenta o próximo
    }
  }

  return { valid: false, reason: 'Assinatura Stellar não confere.' }
}
