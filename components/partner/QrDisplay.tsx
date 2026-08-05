// components/partner/QrDisplay.tsx
'use client'
//
// Exibe o QR Code Pix de uma cobrança de cash-in: imagem (qrCodeImage, URL
// retornada pela API) + o brCode "copia e cola" com botão de copiar.
// Não importa `qrcode` (não é dependência direta) - usa a imagem da própria API.

import React, { useState } from 'react'

export default function QrDisplay({
  brCode,
  qrCodeImage,
}: {
  brCode: string
  qrCodeImage?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard indisponível - usuário pode selecionar o texto manualmente */
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      {qrCodeImage ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrCodeImage}
            alt="QR Code Pix"
            width={220}
            height={220}
            style={{ borderRadius: 12, background: '#fff', padding: 8 }}
          />
        </div>
      ) : null}

      <label style={{ display: 'block', margin: '0 0 4px', fontSize: 13, color: '#9aa4b2' }}>
        Pix copia e cola
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <code
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #2b3142',
            background: '#0f121a',
            color: '#cfe0ff',
            fontSize: 12,
            wordBreak: 'break-all',
            maxHeight: 96,
            overflowY: 'auto',
          }}
        >
          {brCode}
        </code>
        <button onClick={copy} className="btn" style={{ whiteSpace: 'nowrap' }}>
          {copied ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
