'use client'
//
// As OPÇÕES de conexão sem o dialog: só a(s) linha(s) de carteira, o erro da
// última tentativa e a nota de confiança. Não tem overlay, portal, focus-trap
// nem header - é para embrulhar no dialog do próprio design system. Quem quer o
// pacote completo usa <ConnectModal/>, que é este componente dentro de um
// dialog acessível. Mesma divisão do @pagfinance/wallet-connect (ramp-scaffold).
//
// Analogia: ConnectModal é a TV com caixas de som embutidas; WalletOptions é a
// soundbar - o mesmo áudio, no móvel que você escolher.
//
// Scaffold exclusivo do ecossistema Stellar. O Stellar Wallets Kit agrega as
// carteiras (Freighter, Lobstr, xBull, Hana, Albedo) e abre o próprio modal de
// seleção; aqui só oferecemos a entrada para esse fluxo.

import { useState, type CSSProperties } from 'react'
import { useStellarWallet } from '@/contexts/StellarWalletProvider'
import { shortenAddress } from '@/lib/helpers/shortenAddress'
import WalletRow, { type WalletRowProps } from '@/components/wallet/WalletRow'
import { useToast } from '@/components/toast/ToastProvider'
import { CHAIN_REGISTRY } from '@/lib/chains/registry'

export type WalletOptionsProps = {
  /**
   * Chamado quando a conexão/desconexão termina OU quando o fluxo é entregue ao
   * seletor do Stellar Wallets Kit (que abre o próprio modal). O dialog que
   * embrulha as opções deve FECHAR aqui - senão o modal do kit renderiza atrás.
   */
  onDone?: () => void
  /** Mostra a nota "Nunca pedimos sua frase-semente" no rodapé (default: true). */
  showTrustNote?: boolean
  className?: string
  style?: CSSProperties
}

const STELLAR_ICON = CHAIN_REGISTRY.stellar.icon

// ---------- styles ----------
const list: CSSProperties = { display: 'grid', gap: 10 }
const errBox: CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(255,107,107,.08)',
  border: '1px solid rgba(255,107,107,.3)',
  color: '#ffb3b3',
  fontSize: 13,
}
const trust: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: '1px solid #1e2330',
  color: '#8b94a6',
  fontSize: 12,
  lineHeight: 1.5,
}

export default function WalletOptions({
  onDone,
  showTrustNote = true,
  className,
  style,
}: WalletOptionsProps) {
  const toast = useToast()
  const [err, setErr] = useState<string | null>(null)

  const {
    connected: stellarConnected,
    connecting: stellarConnecting,
    address: stellarAddr,
    connect: stellarConnect,
    disconnect: stellarDisconnect,
  } = useStellarWallet()

  const fail = (message: string) => {
    setErr(message)
    toast.error(message)
  }

  const handleStellar = async () => {
    setErr(null)
    // O Stellar Wallets Kit abre o PRÓPRIO modal (authModal) e espera a seleção.
    // Fechamos o nosso ANTES, senão o modal do kit renderiza ATRÁS do nosso.
    onDone?.()
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
      onDone?.()
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Falha ao desconectar.')
    }
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

  return (
    <div className={className} style={style}>
      <div style={{ ...list, marginTop: 6 }}>
        {rows.map(({ key, ...rest }) => (
          <WalletRow key={key} {...rest} />
        ))}
      </div>

      {err && <div style={errBox}>{err}</div>}

      {showTrustNote && (
        <p style={trust}>
          <span aria-hidden="true">🔒 </span>Nunca pedimos sua frase-semente. Você aprova cada
          conexão e transação na sua própria carteira.
        </p>
      )}
    </div>
  )
}
