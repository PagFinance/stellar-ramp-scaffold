// tests/stellarVerifySignature.test.ts
//
// Verificação da prova-de-posse Stellar. Diferente do resto da sessão, isto
// pode ser exercitado de forma determinística: um Keypair Stellar assina a
// mensagem localmente (mesmo Ed25519 que a carteira usa), sem precisar de SDK
// de carteira. Cobre os dois esquemas de assinatura aceitos:
//  - bytes UTF-8 crus da mensagem (carteiras legadas)
//  - SEP-53: ed25519 sobre SHA-256('Stellar Signed Message:\n' + message)
//    (Freighter v6+ e demais carteiras alinhadas ao SEP-0053)
// e ambos os encodings de assinatura (base64 e hex).

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import { verifyStellarSignature } from '@/lib/chains/stellar/verifySignature'

const MESSAGE = [
  'PagFinance - autenticação de carteira',
  'Assine para provar a posse desta carteira. Isto não gera custo nem transação.',
  'address:GBL7JLGBIKCQSI4W6THYJ4HGUE2EQ7BFLNLEQ7U5OOFHNIFRBEGC2DIT',
  'chain:stellar',
  'nonce:cafd08f4-9a82-4624-a5ce-e202d5139b21',
  'iat:1785797570',
].join('\n')

function signBase64(kp: Keypair, message: string): string {
  return kp.sign(Buffer.from(message, 'utf8')).toString('base64')
}

// SEP-53: ed25519 sobre SHA-256('Stellar Signed Message:\n' + message).
function signSep53(kp: Keypair, message: string): Buffer {
  const payload = createHash('sha256')
    .update('Stellar Signed Message:\n')
    .update(message, 'utf8')
    .digest()
  return kp.sign(payload)
}

describe('verifyStellarSignature', () => {
  it('accepts a valid base64 signature over the raw UTF-8 message', () => {
    const kp = Keypair.random()
    const signature = signBase64(kp, MESSAGE)
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: kp.publicKey() })
    expect(r.valid).toBe(true)
  })

  it('accepts a SEP-53 signature (base64) - Freighter v6+ scheme', () => {
    const kp = Keypair.random()
    const signature = signSep53(kp, MESSAGE).toString('base64')
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: kp.publicKey() })
    expect(r.valid).toBe(true)
  })

  it('accepts a SEP-53 signature (hex)', () => {
    const kp = Keypair.random()
    const signature = signSep53(kp, MESSAGE).toString('hex')
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: kp.publicKey() })
    expect(r.valid).toBe(true)
  })

  it('accepts a base64url-encoded signature', () => {
    const kp = Keypair.random()
    const signature = kp.sign(Buffer.from(MESSAGE, 'utf8')).toString('base64url')
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: kp.publicKey() })
    expect(r.valid).toBe(true)
  })

  it('accepts a hex-encoded signature too', () => {
    const kp = Keypair.random()
    const signature = kp.sign(Buffer.from(MESSAGE, 'utf8')).toString('hex')
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: kp.publicKey() })
    expect(r.valid).toBe(true)
  })

  it('rejects a signature from a different key', () => {
    const signer = Keypair.random()
    const other = Keypair.random()
    const signature = signBase64(signer, MESSAGE)
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: other.publicKey() })
    expect(r.valid).toBe(false)
  })

  it('rejects when the signed message differs (tampered message)', () => {
    const kp = Keypair.random()
    const signature = signBase64(kp, MESSAGE)
    const r = verifyStellarSignature({
      message: MESSAGE + '\ntampered:1',
      signature,
      address: kp.publicKey(),
    })
    expect(r.valid).toBe(false)
  })

  it('rejects an invalid Stellar address', () => {
    const kp = Keypair.random()
    const signature = signBase64(kp, MESSAGE)
    const r = verifyStellarSignature({ message: MESSAGE, signature, address: 'not-a-stellar-addr' })
    expect(r.valid).toBe(false)
  })

  it('rejects a garbage signature', () => {
    const kp = Keypair.random()
    const r = verifyStellarSignature({
      message: MESSAGE,
      signature: 'garbage',
      address: kp.publicKey(),
    })
    expect(r.valid).toBe(false)
  })
})
