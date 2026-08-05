/** @type {import('next').NextConfig} */

// Headers de segurança aplicados a todas as respostas. Um scaffold que move
// dinheiro não deveria ser iframável (clickjacking de connect/sign/cash-out).
const securityHeaders = [
  // Impede que o app seja embutido em iframe (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // HSTS: só tem efeito sob HTTPS; inofensivo em dev.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

// Dependências opcionais que algumas libs tentam resolver mas nunca usam no
// browser. Sem isto o build pode emitir avisos "Module not found". Resolvê-las
// para módulo vazio (`false`) limpa o build sem alterar comportamento.
const optionalDeps = ['@react-native-async-storage/async-storage', 'pino-pretty']

const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(optionalDeps.map((dep) => [dep, false])),
    }
    return config
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
export default nextConfig
