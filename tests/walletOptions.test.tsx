// @vitest-environment jsdom
//
// tests/walletOptions.test.tsx
//
// Cobre a divisão do "Conectar carteira" em WalletOptions (só os botões) e
// ConnectModal (o dialog). O caminho crítico é o contrato entre as camadas, que
// um host com dialog próprio depende: `onDone` dispara ANTES do handoff para o
// Stellar Wallets Kit (senão o modal do kit renderiza atrás do dialog do host),
// e um erro NÃO fecha o dialog.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const calls: string[] = []
const toast = { success: vi.fn(), error: vi.fn() }
const stellar = {
  connected: false,
  connecting: false,
  address: null as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
}

vi.mock('@/contexts/StellarWalletProvider', () => ({ useStellarWallet: () => stellar }))
vi.mock('@/components/toast/ToastProvider', () => ({ useToast: () => toast }))

import WalletOptions from '@/components/WalletOptions'
import ConnectModal from '@/components/ConnectModal'

function tracked(name: string) {
  return vi.fn(async (): Promise<void> => {
    calls.push(name)
  })
}

beforeEach(() => {
  calls.length = 0
  Object.assign(stellar, {
    connected: false,
    connecting: false,
    address: null,
    connect: tracked('stellar.connect'),
    disconnect: tracked('stellar.disconnect'),
  })
})

afterEach(() => cleanup())

describe('WalletOptions (só os botões)', () => {
  it('sem dialog; desconectada: fecha o host ANTES de abrir o kit', async () => {
    const onDone = tracked('onDone')
    render(<WalletOptions onDone={onDone} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Freighter, Lobstr, xBull, Hana, Albedo')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('Stellar'))
    })
    expect(calls).toEqual(['onDone', 'stellar.connect'])
  })

  it('conectada: a linha mostra o endereço e o clique desconecta, avisa e fecha', async () => {
    stellar.connected = true
    stellar.address = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV'
    const onDone = tracked('onDone')
    render(<WalletOptions onDone={onDone} />)
    expect(screen.getByText(/^Conectada • GABC/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('Stellar'))
    })
    expect(calls).toEqual(['stellar.disconnect', 'onDone'])
    expect(toast.success).toHaveBeenCalledWith('Carteira desconectada.')
  })

  it('falha ao desconectar: erro visível + toast, host continua aberto', async () => {
    stellar.connected = true
    stellar.disconnect = vi.fn(async () => {
      throw new Error('carteira travada')
    })
    const onDone = vi.fn()
    render(<WalletOptions onDone={onDone} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Stellar'))
    })
    expect(screen.getByText('carteira travada')).toBeTruthy()
    expect(toast.error).toHaveBeenCalledWith('carteira travada')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('falha do kit no handoff: só toast (o host já fechou)', async () => {
    stellar.connect = vi.fn(async () => {
      throw new Error('kit indisponível')
    })
    const onDone = vi.fn()
    render(<WalletOptions onDone={onDone} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Stellar'))
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('kit indisponível')
  })

  it('a nota de confiança é opcional', () => {
    const { rerender } = render(<WalletOptions showTrustNote={false} />)
    expect(screen.queryByText(/frase-semente/)).toBeNull()
    rerender(<WalletOptions />)
    expect(screen.getByText(/frase-semente/)).toBeTruthy()
  })
})

describe('ConnectModal (o dialog)', () => {
  it('fechado não renderiza; aberto é um dialog com título, X, Escape e clique fora', () => {
    const onClose = vi.fn()
    const { rerender } = render(<ConnectModal open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<ConnectModal open onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading').textContent).toBe('Conectar carteira Stellar')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Fechar modal'))
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('o handoff Stellar fecha o dialog via onDone', async () => {
    const onClose = vi.fn()
    render(<ConnectModal open onClose={onClose} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Stellar'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stellar.connect).toHaveBeenCalled()
  })
})
