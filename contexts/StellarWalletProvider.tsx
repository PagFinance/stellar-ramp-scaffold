// contexts/StellarWalletProvider.tsx
'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react'
import {
  StellarWalletsKit,
  KitEventType,
  type Networks,
  type SwkAppTheme,
} from '@creit.tech/stellar-wallets-kit'
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr'
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana'
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo'
import { STELLAR_PASSPHRASE } from '@/lib/chains/stellar/stellarConfig'
import { isValidStellarAddress } from '@/lib/chains/stellar/stellarHelpers'

export type StellarCtx = {
  connected: boolean
  connecting: boolean
  address: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /** Sign a transaction XDR, returns the signed XDR */
  signTransaction: (xdr: string) => Promise<string>
  /** Sign an arbitrary message */
  signMessage: (message: string) => Promise<string>
}

const StellarContext = createContext<StellarCtx | null>(null)

export function useStellarWallet(): StellarCtx {
  const ctx = useContext(StellarContext)
  if (!ctx) throw new Error('useStellarWallet must be used within StellarWalletProvider')
  return ctx
}

const pagDarkTheme: SwkAppTheme = {
  background: '#13152e',
  'background-secondary': '#090a17',
  'foreground-strong': '#ffffff',
  foreground: '#f0f0f0',
  'foreground-secondary': '#9ca3af',
  primary: '#00d4aa',
  'primary-foreground': '#090a17',
  transparent: 'rgba(0, 0, 0, 0)',
  lighter: '#1a1b2e',
  light: '#13152e',
  'light-gray': '#6b7280',
  gray: '#4b5563',
  danger: '#ff6b6b',
  border: 'rgba(26, 27, 46, 0.6)',
  shadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.2)',
  'border-radius': '0.75rem',
  'font-family': 'Inter, system-ui, sans-serif',
}

const pagLightTheme: SwkAppTheme = {
  background: '#FFFFFF',
  'background-secondary': '#F5F7FA',
  'foreground-strong': '#0B1E3F',
  foreground: '#1a1a2e',
  'foreground-secondary': '#6b7280',
  primary: '#00867A',
  'primary-foreground': '#ffffff',
  transparent: 'rgba(0, 0, 0, 0)',
  lighter: '#F5F7FA',
  light: '#FFFFFF',
  'light-gray': '#C3CFDE',
  gray: '#9ca3af',
  danger: '#D94C4C',
  border: 'rgba(195, 207, 222, 0.5)',
  shadow: '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.05)',
  'border-radius': '0.75rem',
  'font-family': 'Inter, system-ui, sans-serif',
}

function getAppTheme(): SwkAppTheme {
  if (typeof document === 'undefined') return pagDarkTheme
  return document.documentElement.dataset.theme === 'light' ? pagLightTheme : pagDarkTheme
}

export const StellarWalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const initialized = useRef(false)

  // Initialize the kit once
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    StellarWalletsKit.init({
      network: STELLAR_PASSPHRASE as Networks,
      theme: getAppTheme(),
      modules: [
        new FreighterModule(),
        new LobstrModule(),
        new xBullModule(),
        new HanaModule(),
        new AlbedoModule(),
      ],
    })

    // Listen for state changes (wallet switches, disconnects)
    StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      const addr = event.payload.address
      if (addr && isValidStellarAddress(addr)) {
        setAddress(addr)
        setConnected(true)
      } else {
        setAddress(null)
        setConnected(false)
      }
    })

    StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      setAddress(null)
      setConnected(false)
    })
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      StellarWalletsKit.setTheme(getAppTheme())
      const { address: addr } = await StellarWalletsKit.authModal()
      if (addr && isValidStellarAddress(addr)) {
        setAddress(addr)
        setConnected(true)
      }
    } catch (err) {
      console.error('[Stellar] Erro ao conectar wallet:', err)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect()
    } catch (err) {
      console.warn('[Stellar] Erro ao desconectar:', err)
    }
    setAddress(null)
    setConnected(false)
  }, [])

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: STELLAR_PASSPHRASE,
        address: address ?? undefined,
      })
      return signedTxXdr
    },
    [address],
  )

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      const { signedMessage } = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: STELLAR_PASSPHRASE,
        address: address ?? undefined,
      })
      return signedMessage
    },
    [address],
  )

  // Memoizado para não recriar o objeto de contexto a cada render (evitava
  // re-render de todos os consumidores). As funções já são useCallback-estáveis.
  const ctx = useMemo<StellarCtx>(
    () => ({
      connected,
      connecting,
      address,
      connect,
      disconnect,
      signTransaction,
      signMessage,
    }),
    [connected, connecting, address, connect, disconnect, signTransaction, signMessage],
  )

  return <StellarContext.Provider value={ctx}>{children}</StellarContext.Provider>
}
