// components/common/SingleConnectionGuard.tsx
'use client'

import { useEffect, useRef } from 'react'
import { type ChainId, ChainsIDS } from '@/lib/types/ChainTypes'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import type { ChainSlice } from '@/lib/types/WalletSlice'

type Props = {
  /** Chamado sempre que o vencedor muda */
  onWinnerChange?: (winner: ChainId) => void
}

// Cria um Record<ChainId, T> inicial derivado de ChainsIDS (fonte única). Assim
// adicionar uma chain no registry NÃO exige editar shapes hardcoded aqui.
function initRecord<T>(value: T): Record<ChainId, T> {
  return Object.fromEntries(ChainsIDS.map((id) => [id, value])) as Record<ChainId, T>
}

/** Exclusividade: a última conexão (em tempo real) derruba as outras. */
export default function SingleConnectionGuard({ onWinnerChange }: Props) {
  const { chains } = useWalletWeb3()

  const prevConnected = useRef<Record<ChainId, boolean>>(initRecord(false))
  const lastUpTs = useRef<Record<ChainId, number>>(initRecord(0))
  const lastWinner = useRef<ChainId | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    const slices = chains as Record<ChainId, ChainSlice>
    const curr = initRecord(false)
    ChainsIDS.forEach((id) => {
      curr[id] = slices[id]?.connected ?? false
    })

    // marca timestamp para qualquer transição false→true
    ChainsIDS.forEach((id) => {
      if (!prevConnected.current[id] && curr[id]) {
        lastUpTs.current[id] = Date.now()
      }
    })

    // vencedor = conectado com maior timestamp
    let winner: ChainId | null = null
    let bestTs = -1
    ChainsIDS.forEach((id) => {
      if (curr[id] && lastUpTs.current[id] > bestTs) {
        bestTs = lastUpTs.current[id]
        winner = id
      }
    })

    if (!winner || winner === lastWinner.current || busy.current) {
      prevConnected.current = curr
      return
    }

    const decidedWinner = winner
    busy.current = true

    // desconecta todos menos o vencedor; AGUARDA a conclusão antes de liberar
    // `busy` (evita janela em que duas conexões coexistem - finding #10).
    const toDisconnect = ChainsIDS.filter(
      (id) =>
        id !== decidedWinner &&
        slices[id]?.connected &&
        typeof slices[id]?.disconnect === 'function',
    )
    void Promise.all(
      toDisconnect.map((id) =>
        Promise.resolve(slices[id]!.disconnect!()).catch((e) =>
          console.warn('[SingleConnectionGuard] disconnect falhou:', id, e),
        ),
      ),
    ).finally(() => {
      busy.current = false
    })

    lastWinner.current = decidedWinner
    prevConnected.current = curr
    onWinnerChange?.(decidedWinner)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ...ChainsIDS.map((id) => (chains as Record<ChainId, ChainSlice>)[id]?.connected ?? false),
    onWinnerChange,
  ])

  return null
}
