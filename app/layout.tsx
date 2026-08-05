import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import Providers from './providers'
import HeaderWithConnect from '@/components/HeaderWithConnect'

// Mesmas famílias do site da marca (pag.finance): Fraunces no display, Inter no
// corpo. `variable` expõe as fontes como custom properties consumidas pelos
// tokens --font-display / --font-body em globals.css.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK', 'opsz'],
})

// Nome do produto vem do env (cada fork define o seu). Default neutro do scaffold.
const APP_NAME = process.env.NEXT_PUBLIC_PROJECT_NAME || 'PagFinance - Stellar Ramp Scaffold'
const APP_DESCRIPTION = 'PagFinance Scaffold para carteiras Stellar em apps de on/off-ramp com Pix.'

export const metadata: Metadata = {
  title: { default: `${APP_NAME} - On/Off-ramp`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  icons: { icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' } },
  openGraph: {
    title: `${APP_NAME} - On/Off-ramp`,
    description: APP_DESCRIPTION,
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#090a17',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // O Stellar Wallets Kit injeta variáveis de tema (--swk-*) no <html> no
    // cliente; o HTML do servidor não as tem, o que gera aviso de hidratação.
    // suppressHydrationWarning cobre atributos do próprio <html> setados por
    // libs de terceiros (padrão recomendado pelo Next para este caso).
    <html
      lang="pt-BR"
      className={`${inter.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <Providers>
          <HeaderWithConnect />
          <main className="container">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
