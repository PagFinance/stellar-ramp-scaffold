'use client'
//
// Linha (botão) de carteira do ConnectModal. Componente PURAMENTE presentational:
// concentra o markup/estilo que antes era repetido em ~8 linhas idênticas.
// Não contém lógica de conexão - recebe onClick/estado por props.

import type { CSSProperties, ReactNode } from 'react'

const itemBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  background: '#1b1f2a',
  border: '1px solid #282c3a',
  borderRadius: 12,
  cursor: 'pointer',
  textAlign: 'left',
  position: 'relative',
}
// Caixa de ícone com tamanho FIXO. Sem isto, os data-URIs dos connectors
// (Trust, Phantom…) renderizam no tamanho natural e estouram a linha.
const iconBox: CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 24,
}
const iconImg: CSSProperties = {
  width: 28,
  height: 28,
  objectFit: 'contain',
  borderRadius: 8,
  display: 'block',
}
const labelStyle: CSSProperties = { color: '#c3d3e8', fontWeight: 600 }
const subStyle: CSSProperties = { color: '#9aa4b2', fontSize: 12 }
const pillBase: CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 12,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
}
const pillConnected: CSSProperties = {
  ...pillBase,
  background: '#143d24',
  color: '#7ae2a4',
  border: '1px solid #275238',
}
const pillConnecting: CSSProperties = {
  ...pillBase,
  background: '#2a2f45',
  color: '#b9c1ff',
  border: '1px solid #3b4370',
}

export type WalletRowProps = {
  /** Ícone via URL (img) - ex.: logo da chain. */
  iconSrc?: string
  iconAlt?: string
  /** Ícone via node (ex.: emoji). Usado quando não há `iconSrc`. */
  iconNode?: ReactNode
  label: string
  subtitle?: ReactNode
  connected?: boolean
  connecting?: boolean
  disabled?: boolean
  onClick: () => void
}

export default function WalletRow({
  iconSrc,
  iconAlt,
  iconNode,
  label,
  subtitle,
  connected,
  connecting,
  disabled,
  onClick,
}: WalletRowProps) {
  return (
    <button style={itemBtn} onClick={onClick} disabled={disabled}>
      <span style={iconBox}>
        {iconSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconSrc} alt={iconAlt ?? label} style={iconImg} />
        ) : (
          iconNode
        )}
      </span>
      <div style={{ minWidth: 0, flex: 1, paddingRight: connected || connecting ? 84 : 0 }}>
        <div style={labelStyle}>{label}</div>
        {subtitle != null && <div style={subStyle}>{subtitle}</div>}
      </div>
      {connecting && <span style={pillConnecting}>Conectando…</span>}
      {connected && <span style={pillConnected}>Conectado</span>}
    </button>
  )
}
