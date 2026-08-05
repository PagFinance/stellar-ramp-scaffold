// components/partner/formStyles.ts
//
// Texto de ajuda dos formulários. Os campos (label/input/select) foram unificados
// nas classes .pf-label/.pf-input/.pf-select (app/globals.css) - uma fonte só, com
// anel de foco e associação label↔input. Só `helpText` permanece aqui.
import type { CSSProperties } from 'react'

export const helpText: CSSProperties = { marginTop: 8, fontSize: 12, color: 'var(--muted)' }
