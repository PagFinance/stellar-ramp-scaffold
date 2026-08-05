// instrumentation.ts
//
// O Next.js chama `register()` uma única vez no boot do servidor (antes de
// atender requisições). Usamos isso como preflight de produção: falhar cedo e
// alto quando segredos obrigatórios faltam, em vez de servir rotas de dinheiro
// em modo inseguro. Ver `assertProductionEnv` em `lib/env.ts`.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('./lib/env')
    assertProductionEnv()
  }
}
