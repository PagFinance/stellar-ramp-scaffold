// components/partner/kyc/KycSessionResult.tsx
'use client'
//
// Estado da sessão de onboarding KYC/KYB, exibido no trilho lateral da página.
import React from 'react'
import KybCompanyChecks from './KybCompanyChecks'
import type { KycSession, KycSessionStatusValue } from '@/lib/partner/types'

const STATUS_LABEL: Record<KycSessionStatusValue, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  EXPIRED: 'Expirado',
  ERROR: 'Erro',
}

// Cor do ponto de status. Só o terminal bem-sucedido acende o teal da marca;
// os demais ficam neutros ou em erro, para o verde não virar ruído.
const STATUS_TONE: Record<KycSessionStatusValue, string> = {
  PENDING: 'var(--muted)',
  IN_PROGRESS: 'var(--warning)',
  APPROVED: 'var(--success)',
  REJECTED: 'var(--danger)',
  EXPIRED: 'var(--muted)',
  ERROR: 'var(--danger)',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 2, marginTop: 12 }}>
      <span className="rail-label" style={{ margin: 0 }}>
        {label}
      </span>
      <span className="rail-value">{children}</span>
    </div>
  )
}

export default function KycSessionResult({
  session,
  polling,
  onReset,
}: {
  session: KycSession
  polling?: boolean
  onReset?: () => void
}) {
  const label = STATUS_LABEL[session.status] ?? session.status

  return (
    <div className="rail-card">
      <p className="rail-label">Sessão</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: STATUS_TONE[session.status] ?? 'var(--muted)',
          }}
        />
        <strong style={{ fontSize: 14, fontWeight: 600 }}>{label}</strong>
        {polling ? (
          <span className="muted" style={{ fontSize: 11.5 }}>
            atualizando…
          </span>
        ) : null}
      </div>

      <Row label="ID">{session.sessionId}</Row>
      <Row label="Documento">{session.documentMasked}</Row>
      <Row label="Provider">{session.provider}</Row>
      {/* Numa sessão PJ o documento acima é o CNPJ, mas quem faz a
          documentoscopia é uma PESSOA - sem esta linha não dá para saber de
          quem é a selfie que o link vai pedir. */}
      {session.representativeMasked ? (
        <Row label="Representante legal">{session.representativeMasked}</Row>
      ) : null}

      {session.companyVerification ? (
        <div style={{ marginTop: 14 }}>
          <p className="rail-label" style={{ margin: '0 0 8px' }}>
            Verificação da empresa
          </p>
          <KybCompanyChecks verification={session.companyVerification} compact />
        </div>
      ) : null}

      {session.rejectionReason ? (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'var(--danger-ink)',
          }}
        >
          {session.rejectionReason}
        </p>
      ) : null}

      {session.webViewUrl && session.status !== 'APPROVED' ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <a
            href={session.webViewUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-sm"
          >
            Continuar verificação ↗
          </a>
          <p className="rail-empty" style={{ fontSize: 11.5 }}>
            {session.representativeMasked
              ? `Abre a captura de documento e selfie do representante legal (${session.representativeMasked}).`
              : 'Abre o provider para a captura de documento e selfie.'}
          </p>
        </div>
      ) : null}

      {onReset ? (
        <div style={{ marginTop: 12 }}>
          <button onClick={onReset} className="btn btn-outline btn-sm" style={{ width: '100%' }}>
            Nova verificação
          </button>
        </div>
      ) : null}
    </div>
  )
}
