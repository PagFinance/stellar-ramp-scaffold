// hooks/useKycLookup.ts
'use client'
//
// Consulta cadastral de CPF/CNPJ contra a Partner API, para preencher
// automaticamente os formulários de KYC/KYB.
//
//   lookup({ documentType, documentNumber })
//     → garante a sessão de carteira (prova-de-posse) em modo seguro
//     → POST /api/partner/kyc/lookup  (o HMAC fica no servidor Next)
//     → devolve o resultado normalizado, ou null quando não encontrado.
//
// É uma ação sob demanda (o usuário clica "Buscar dados"), não estado de
// servidor derivado - por isso segue o mesmo formato imperativo do useKyc em vez
// de virar uma query.
//
// A sessão de carteira é a MESMA exigida pelas rotas de onboarding: a rota de
// lookup a exige para não virar um oráculo anônimo de consulta de documentos.

import { useCallback, useMemo, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { postKycLookup, PartnerRequestError } from '@/lib/partner/browserClient'
import { getPartnerSession, establishPartnerSession } from '@/lib/partner/session'
import type {
  DocumentLookupRequest,
  DocumentLookupData,
  KycDocumentType,
} from '@/lib/partner/types'

export interface UseKycLookup {
  busy: boolean
  error: string | null
  /** true quando a consulta respondeu que o documento não existe (404). */
  notFound: boolean
  data: DocumentLookupData | null
  /** Retorna o resultado, ou null em erro/não encontrado (o motivo fica em `error`). */
  lookup: (
    documentType: KycDocumentType,
    documentNumber: string,
  ) => Promise<DocumentLookupData | null>
  reset: () => void
}

export function useKycLookup(): UseKycLookup {
  const { activeAddress, activeChainId, activeWallet } = useWalletWeb3()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [data, setData] = useState<DocumentLookupData | null>(null)

  const reset = useCallback(() => {
    setBusy(false)
    setError(null)
    setNotFound(false)
    setData(null)
  }, [])

  const toMessage = (e: unknown) =>
    e instanceof PartnerRequestError
      ? e.message
      : e instanceof Error
        ? e.message
        : 'Erro inesperado.'

  // Mesma lógica de useKyc.ensureSession: no-op em dev (backend sem
  // APP_SESSION_SECRET), obrigatória em modo seguro.
  const ensureSession = useCallback(async (): Promise<string | null> => {
    try {
      const s = await getPartnerSession()
      if (!s.configured) return null // dev: rota segue aberta
      if (!activeAddress || !activeChainId)
        return 'Conecte uma carteira para consultar o documento.'
      if (s.address && s.address === activeAddress) return null
      if (!activeWallet?.signMessage) {
        return 'A carteira ativa não suporta assinatura de mensagem para autenticar.'
      }
      const r = await establishPartnerSession({
        address: activeAddress,
        blockchain: activeChainId,
        publicKey: activeWallet.publicKey ?? null,
        signMessage: (m) => activeWallet.signMessage!(m),
      })
      return r.ok ? null : (r.error ?? 'Falha ao autenticar a carteira.')
    } catch (e) {
      return toMessage(e)
    }
  }, [activeAddress, activeChainId, activeWallet])

  const lookup = useCallback(
    async (
      documentType: KycDocumentType,
      documentNumber: string,
    ): Promise<DocumentLookupData | null> => {
      setError(null)
      setNotFound(false)
      setData(null)
      setBusy(true)
      try {
        const sessionError = await ensureSession()
        if (sessionError) {
          setError(sessionError)
          return null
        }
        const body: DocumentLookupRequest = { documentType, documentNumber, country: 'BR' }
        const result = await postKycLookup(body)
        setData(result)
        return result
      } catch (e) {
        // 404 é uma resposta com autoridade ("não existe na Receita"), não uma
        // falha de infraestrutura - a UI trata os dois casos de forma diferente.
        if (e instanceof PartnerRequestError && e.status === 404) {
          setNotFound(true)
          setError(
            documentType === 'CNPJ'
              ? 'CNPJ não encontrado na base da Receita Federal.'
              : 'CPF não encontrado na base da Receita Federal.',
          )
          return null
        }
        setError(toMessage(e))
        return null
      } finally {
        setBusy(false)
      }
    },
    [ensureSession],
  )

  return useMemo<UseKycLookup>(
    () => ({ busy, error, notFound, data, lookup, reset }),
    [busy, error, notFound, data, lookup, reset],
  )
}
