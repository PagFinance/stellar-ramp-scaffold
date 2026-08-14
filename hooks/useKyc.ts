// hooks/useKyc.ts
'use client'
//
// Orquestra o onboarding KYC (PF) / KYB (PJ) contra a Partner API:
//
//   submitNaturalPerson(body) | submitLegalPerson(body)
//     → garante a sessão de carteira (prova-de-posse) em modo seguro
//     → cria a sessão (status inicial PENDING/IN_PROGRESS, possível webViewUrl)
//     → polling do status via sync até terminal (APPROVED/REJECTED/EXPIRED/ERROR).
//
// Em modo seguro (APP_SESSION_SECRET no backend) as rotas /api/partner/kyc/*
// EXIGEM a sessão de carteira e derivam o externalUserId do endereço provado
// (fecha o NEW-H2). Em dev (sem o segredo) seguem abertas com o externalUserId
// do cliente. O cookie de sessão é httpOnly e same-origin (enviado automaticamente).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import {
  postKycNaturalPerson,
  postKycLegalPerson,
  postKycSync,
  PartnerRequestError,
} from '@/lib/partner/browserClient'
import { getPartnerSession, establishPartnerSession } from '@/lib/partner/session'
import type {
  KycNaturalPersonRequest,
  KycLegalPersonRequest,
  KybCompanyVerification,
  KycSession,
  KycSessionStatusValue,
} from '@/lib/partner/types'

export type KycPhase = 'idle' | 'submitting' | 'pending' | 'completed' | 'failed'

const TERMINAL: KycSessionStatusValue[] = ['APPROVED', 'REJECTED', 'EXPIRED', 'ERROR']
const POLL_INTERVAL_MS = 6_000
const POLL_TIMEOUT_MS = 5 * 60_000

export interface UseKyc {
  phase: KycPhase
  busy: boolean
  error: string | null
  session: KycSession | null
  /**
   * Perna EMPRESA do KYB quando ela REPROVA (422). A sessão não chega a existir
   * nesse caso - a partner-api não persiste nada, justamente para a empresa
   * poder se regularizar e tentar de novo - então os checks vêm por aqui, e não
   * por `session.companyVerification`.
   */
  companyRejection: KybCompanyVerification | null
  /** Retorna null em sucesso ou a mensagem de erro. */
  submitNaturalPerson: (body: KycNaturalPersonRequest) => Promise<string | null>
  submitLegalPerson: (body: KycLegalPersonRequest) => Promise<string | null>
  reset: () => void
}

export function useKyc(): UseKyc {
  const { activeAddress, activeChainId, activeWallet } = useWalletWeb3()

  const [phase, setPhase] = useState<KycPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<KycSession | null>(null)
  const [companyRejection, setCompanyRejection] = useState<KybCompanyVerification | null>(null)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPoll = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  const reset = useCallback(() => {
    clearPoll()
    setPhase('idle')
    setError(null)
    setSession(null)
    setCompanyRejection(null)
  }, [])

  const toMessage = (e: unknown) =>
    e instanceof PartnerRequestError
      ? e.message
      : e instanceof Error
        ? e.message
        : 'Erro inesperado.'

  // Garante a sessão de carteira (prova-de-posse) antes das rotas KYC em modo
  // seguro. No-op em dev (backend sem APP_SESSION_SECRET). Mesma lógica de
  // useCashin.ensureSession.
  const ensureSession = useCallback(async (): Promise<boolean> => {
    try {
      const s = await getPartnerSession()
      if (!s.configured) return true // dev: rotas KYC seguem abertas
      if (!activeAddress || !activeChainId) {
        setError('Conecte uma carteira para verificar sua identidade.')
        return false
      }
      if (s.address && s.address === activeAddress) return true
      if (!activeWallet?.signMessage) {
        setError('A carteira ativa não suporta assinatura de mensagem para autenticar.')
        return false
      }
      const r = await establishPartnerSession({
        address: activeAddress,
        blockchain: activeChainId,
        publicKey: activeWallet.publicKey ?? null,
        signMessage: (m) => activeWallet.signMessage!(m),
      })
      if (!r.ok) {
        setError(r.error ?? 'Falha ao autenticar a carteira.')
        return false
      }
      return true
    } catch (e) {
      setError(toMessage(e))
      return false
    }
  }, [activeAddress, activeChainId, activeWallet])

  const pollSession = useCallback((sessionId: string, deadline: number) => {
    const tick = async () => {
      try {
        const s = await postKycSync(sessionId)
        setSession(s)
        if (TERMINAL.includes(s.status)) {
          setPhase(s.status === 'APPROVED' ? 'completed' : 'failed')
          if (s.status !== 'APPROVED') {
            setError(s.rejectionReason ?? `Sessão ${s.status.toLowerCase()}.`)
          }
          return
        }
      } catch {
        // erros transitórios de polling não derrubam o fluxo
      }
      if (Date.now() >= deadline) return // deixa de acompanhar; consulta manual depois
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
    }
    pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
  }, [])

  const runSubmit = useCallback(
    async (fn: () => Promise<KycSession>): Promise<string | null> => {
      clearPoll()
      setError(null)
      setSession(null)
      setCompanyRejection(null)
      setPhase('submitting')
      if (!(await ensureSession())) {
        setPhase('failed')
        return 'Autenticação de carteira necessária.'
      }
      try {
        const s = await fn()
        setSession(s)
        if (TERMINAL.includes(s.status)) {
          setPhase(s.status === 'APPROVED' ? 'completed' : 'failed')
          if (s.status !== 'APPROVED')
            setError(s.rejectionReason ?? `Sessão ${s.status.toLowerCase()}.`)
        } else {
          setPhase('pending')
          pollSession(s.sessionId, Date.now() + POLL_TIMEOUT_MS)
        }
        return null
      } catch (e) {
        // 422 KYB_COMPANY_REJECTED: a empresa reprovou na Receita. Não existe
        // sessão para acompanhar - o que a tela mostra são os checks.
        if (e instanceof PartnerRequestError && e.code === 'KYB_COMPANY_REJECTED') {
          const v = (e.data as { companyVerification?: KybCompanyVerification } | undefined)
            ?.companyVerification
          if (v) setCompanyRejection(v)
        }
        const m = toMessage(e)
        setError(m)
        setPhase('failed')
        return m
      }
    },
    [pollSession, ensureSession],
  )

  const submitNaturalPerson = useCallback(
    (body: KycNaturalPersonRequest) => runSubmit(() => postKycNaturalPerson(body)),
    [runSubmit],
  )

  const submitLegalPerson = useCallback(
    (body: KycLegalPersonRequest) => runSubmit(() => postKycLegalPerson(body)),
    [runSubmit],
  )

  useEffect(() => () => clearPoll(), [])

  const busy = phase === 'submitting'

  return useMemo<UseKyc>(
    () => ({
      phase,
      busy,
      error,
      session,
      companyRejection,
      submitNaturalPerson,
      submitLegalPerson,
      reset,
    }),
    [phase, busy, error, session, companyRejection, submitNaturalPerson, submitLegalPerson, reset],
  )
}
