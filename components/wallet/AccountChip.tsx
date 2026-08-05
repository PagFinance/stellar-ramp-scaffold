'use client'
//
// Chip de identidade da conta conectada: identicon (gradiente determinístico a
// partir do endereço), endereço encurtado, copiar com feedback e link para o
// explorer. Dá ao usuário leigo os sinais básicos de "estou conectado, e esta é
// a minha conta" - sem depender de ler um endereço cru gigante.

import { useMemo, useState } from 'react'
import type { ChainId } from '@/lib/types/ChainTypes'
import { shortenAddress } from '@/lib/helpers/shortenAddress'
import { explorerAddressUrl } from '@/lib/explorer'

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Gradiente estável derivado do endereço (identicon minimalista). */
function identiconGradient(address: string): string {
  const h = hashString(address)
  const hue1 = h % 360
  const hue2 = (hue1 + 90 + ((h >> 8) % 120)) % 360
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 70% 45%))`
}

export default function AccountChip({
  chainId,
  address,
  networkLabel,
}: {
  chainId: ChainId | null
  address: string
  /** Rótulo da rede/carteira (ex.: "Stellar"). */
  networkLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const gradient = useMemo(() => identiconGradient(address), [address])
  const explorer = explorerAddressUrl(chainId, address)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard indisponível - ignora silenciosamente */
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: '#12141a',
        border: '1px solid #222531',
        borderRadius: 12,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 34, height: 34, borderRadius: 10, background: gradient, flexShrink: 0 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#5fd6a4', fontWeight: 600 }}>● Conectado</span>
          {networkLabel && <span style={{ fontSize: 12, color: '#8b94a6' }}>· {networkLabel}</span>}
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 14,
            color: '#e6edf3',
            marginTop: 1,
          }}
          title={address}
        >
          {shortenAddress(address)}
        </div>
      </div>

      <button
        onClick={copy}
        className="btn btn-sm"
        style={{ whiteSpace: 'nowrap' }}
        aria-label="Copiar endereço"
      >
        {copied ? 'Copiado ✓' : 'Copiar'}
      </button>
      {explorer && (
        <a
          href={explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-outline"
          style={{ whiteSpace: 'nowrap' }}
        >
          Explorer ↗
        </a>
      )}
    </div>
  )
}
