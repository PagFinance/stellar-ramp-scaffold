'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStellarWallet } from '@/contexts/StellarWalletProvider'
import { shortenAddress } from '@/lib/helpers/shortenAddress'
import WalletRow, { type WalletRowProps } from '@/components/wallet/WalletRow'
import { useToast } from '@/components/toast/ToastProvider'
import { CHAIN_REGISTRY } from '@/lib/chains/registry'

// Scaffold exclusivo do ecossistema Stellar. O Stellar Wallets Kit agrega as
// carteiras (Freighter, Lobstr, xBull, Hana, Albedo) e abre o próprio modal de
// seleção; aqui só oferecemos a entrada para esse fluxo.

type Props = {
  open: boolean
  onClose: () => void
}

const STELLAR_ICON = CHAIN_REGISTRY.stellar.icon

export default function ConnectModal({ open, onClose }: Props) {
  const toast = useToast()

  const [mounted, setMounted] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)

  const {
    connected: stellarConnected,
    connecting: stellarConnecting,
    address: stellarAddr,
    connect: stellarConnect,
    disconnect: stellarDisconnect,
  } = useStellarWallet()

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) setErr(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Foco inicial + focus-trap + restauração de foco ao fechar (a11y de diálogo).
  useEffect(() => {
    if (!open || !mounted) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const node = modalRef.current
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a,button,[tabindex]:not([tabindex="-1"]),input,select,textarea',
            ),
          ).filter(
            (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
          )
        : []

    focusable()[0]?.focus()

    const handleFocus = (e: FocusEvent) => {
      if (node && !node.contains(e.target as Node)) focusable()[0]?.focus()
    }
    document.addEventListener('focusin', handleFocus)
    return () => {
      document.removeEventListener('focusin', handleFocus)
      // Só restaura o foco se ninguém o assumiu (caiu no body). Se o modal do
      // Stellar Wallets Kit já tomou o foco no handoff, NÃO roubamos de volta.
      const active = document.activeElement
      if (!active || active === document.body) previouslyFocused?.focus?.()
    }
  }, [open, mounted])

  if (!mounted || !open) return null

  const fail = (message: string) => {
    setErr(message)
    toast.error(message)
  }

  const handleStellar = async () => {
    setErr(null)
    // O Stellar Wallets Kit abre o PRÓPRIO modal (authModal) e espera a seleção.
    // Fechamos o nosso ANTES, senão o modal do kit renderiza ATRÁS do nosso.
    onClose()
    try {
      await stellarConnect()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conectar a carteira Stellar.')
    }
  }

  const handleDisconnect = async () => {
    try {
      await stellarDisconnect()
      toast.success('Carteira desconectada.')
      onClose()
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Falha ao desconectar.')
    }
  }

  // ---------- styles ----------
  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  }
  const modal: React.CSSProperties = {
    width: 460,
    maxWidth: '92vw',
    maxHeight: '88vh',
    overflowY: 'auto',
    background: '#12141a',
    color: '#fff',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 20px 60px rgba(0,0,0,.45)',
    border: '1px solid #222531',
  }
  const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 }
  const title: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }
  const closeBtn: React.CSSProperties = {
    background: 'transparent',
    color: '#aab2c0',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
  }
  const list: React.CSSProperties = { display: 'grid', gap: 10 }
  const errBox: React.CSSProperties = {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(255,107,107,.08)',
    border: '1px solid rgba(255,107,107,.3)',
    color: '#ffb3b3',
    fontSize: 13,
  }
  const trust: React.CSSProperties = {
    marginTop: 14,
    paddingTop: 12,
    borderTop: '1px solid #1e2330',
    color: '#8b94a6',
    fontSize: 12,
    lineHeight: 1.5,
  }

  const rows: Array<WalletRowProps & { key: string }> = [
    {
      key: 'net-stellar',
      iconSrc: STELLAR_ICON,
      iconAlt: 'Stellar',
      label: 'Stellar',
      subtitle: stellarConnected
        ? `Conectada • ${shortenAddress(stellarAddr ?? '')}`
        : 'Freighter, Lobstr, xBull, Hana, Albedo',
      connected: stellarConnected,
      connecting: stellarConnecting,
      disabled: stellarConnecting,
      onClick: stellarConnected ? handleDisconnect : handleStellar,
    },
  ]

  const content = (
    <div style={overlay} onClick={onClose}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Conectar carteira"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        <div style={headerRow}>
          <h2 style={title}>Conectar carteira Stellar</h2>
          <button aria-label="Fechar modal" style={closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ ...list, marginTop: 6 }}>
          {rows.map(({ key, ...rest }) => (
            <WalletRow key={key} {...rest} />
          ))}
        </div>

        {err && <div style={errBox}>{err}</div>}

        <p style={trust}>
          <span aria-hidden="true">🔒 </span>Nunca pedimos sua frase-semente. Você aprova cada
          conexão e transação na sua própria carteira.
        </p>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
