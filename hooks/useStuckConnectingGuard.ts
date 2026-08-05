'use client'

import { useEffect, useState } from 'react'

/**
 * Protege a UI contra o estado "conectando" que fica PRESO em `true`.
 *
 * Algumas carteiras deixam a promise de `connect()` **pendente para sempre**
 * quando o usuário fecha a janela de
 * aprovação da carteira sem aprovar/rejeitar - fechar a popup ≠ rejeitar. Nesse
 * caso o `connecting` do provider nunca volta a `false` (o `finally` interno não
 * roda), travando o botão do header em "Conectando..." e desabilitado até um
 * reload da página.
 *
 * Como não dá para resetar o estado interno do adapter de fora, este guard
 * "expira" o estado de conexão no app quando ele passa do tempo esperado:
 *
 *  - **retorno de foco à página** (recuperação rápida): quando a popup da
 *    carteira fecha, o foco volta para a nossa aba; damos uma folga curta para a
 *    conexão de fato completar e, se ainda estiver "conectando", expiramos.
 *  - **backstop por tempo**: mesmo sem evento de foco, expira após o timeout.
 *
 * Retorna o `connecting` efetivo (já com o guard aplicado). Quando o `connecting`
 * de entrada volta a `false` naturalmente (conexão OK ou erro), o guard reseta.
 */
export function useStuckConnectingGuard(
  connecting: boolean,
  opts?: { focusGraceMs?: number; hardTimeoutMs?: number },
): boolean {
  const focusGraceMs = opts?.focusGraceMs ?? 6000
  const hardTimeoutMs = opts?.hardTimeoutMs ?? 45000
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!connecting) {
      setExpired(false)
      return
    }
    setExpired(false)

    let focusTimer: ReturnType<typeof setTimeout> | undefined
    const onFocus = () => {
      // A popup fechou e o foco voltou: se em `focusGraceMs` a conexão não
      // concluir (o que zeraria `connecting`), tratamos como abortada.
      clearTimeout(focusTimer)
      focusTimer = setTimeout(() => setExpired(true), focusGraceMs)
    }
    const hardTimer = setTimeout(() => setExpired(true), hardTimeoutMs)
    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
      clearTimeout(focusTimer)
      clearTimeout(hardTimer)
    }
  }, [connecting, focusGraceMs, hardTimeoutMs])

  return connecting && !expired
}
