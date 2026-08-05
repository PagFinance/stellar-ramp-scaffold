# 06 - Variáveis de ambiente (referência completa)

Referência de **todas** as variáveis de ambiente do scaffold: escopo, se são obrigatórias,
default, o que fazem e o que acontece quando faltam. A fonte canônica da lista é
[`.env.example`](../.env.example); a validação server-side está em [`lib/env.ts`](../lib/env.ts)
(zod, `getServerEnv()`, memoizado - lança um erro agregado na primeira chamada se inválido).

Este scaffold é **exclusivo do Stellar**: não há variáveis de RPC EVM/Solana/TRON, WalletConnect,
Xaman/XUMM nem chaves de carteiras de outras chains.

> **Regra de escopo (importante para segurança):** tudo que começa com `NEXT_PUBLIC_` é **inlinado
> no bundle do browser** e fica visível para qualquer visitante. Nunca coloque segredo em
> `NEXT_PUBLIC_*`. As demais variáveis são **server-only** (só o código em `app/api/*` e `lib/server/*`
> as lê) - é onde ficam o HMAC secret e o segredo de sessão.

---

## TL;DR - mínimo para subir

Copie `.env.example` para `.env.local` e preencha conforme o cenário.

### Desenvolvimento local (`npm run dev`)

**Nenhuma variável é obrigatória para o app subir.** O servidor inicia mesmo com o `.env` vazio.
Consequências de deixar em branco:

- Sem `PARTNER_*` → as rotas `app/api/partner/*` respondem **503 "Partner API não configurada"**
  (não 500). O resto do app funciona.
- Sem `APP_SESSION_SECRET` → sessão de carteira em **modo legado** (dev): as rotas de cash-in/out
  confiam no `sender` do cliente, com um `console.warn`. Aceitável só no demo local.
- Sem os `NEXT_PUBLIC_STELLAR_*` → cai nos defaults (rede `PUBLIC`, Horizon público).

### Produção (`next build` + `next start`, ou deploy → `NODE_ENV=production`)

| Obrigatória em produção | Por quê |
|---|---|
| **`APP_SESSION_SECRET`** (≥16 chars) | O preflight em [`instrumentation.ts`](../instrumentation.ts) **derruba o boot** se faltar (ver ⚠️ abaixo). Sem ela, **todas** as rotas retornam 500. |
| **`PARTNER_API_BASE_URL`** | Sem ela os fluxos partner respondem 503. |
| **`PARTNER_ID`** + **`PARTNER_RAW_SECRET`** | Credenciais HMAC do parceiro; sem elas, 503 nos fluxos de cash-in/out. |

Fortemente recomendadas em produção (não derrubam o boot, mas afetam segurança/UX):
`TRUSTED_CLIENT_IP_HEADER` **ou** `TRUSTED_PROXY_COUNT` (rate-limit correto atrás de proxy) e
`NEXT_PUBLIC_PROJECT_URL` (CORS travado por origem).

> ### ⚠️ A causa nº 1 de "500 em todas as rotas"
> Em `NODE_ENV=production`, `instrumentation.ts#register()` chama `assertProductionEnv()`, que
> **lança** se `APP_SESSION_SECRET` faltar ou tiver menos de 16 chars. Um throw no `register()` faz o
> servidor **não inicializar** - e aí **toda** rota (inclusive as públicas e a `/api/partner/session`,
> que é local) retorna **500**. Se você vê 500 generalizado, olhe o log do boot: a mensagem
> `[preflight] Configuração de produção inválida` confirma o caso. **Correção:** definir
> `APP_SESSION_SECRET` e redeploy. Gere um segredo forte com `openssl rand -base64 32`.

---

## App / metadados

| Variável | Escopo | Obrigatória | Default | O que faz / se faltar |
|---|---|---|---|---|
| `NEXT_PUBLIC_PROJECT_NAME` | client | Não | `PagFinance - Stellar Ramp Scaffold` (`app/layout.tsx`) | Nome exibido na UI e no metadata da página. Cosmético. |
| `NEXT_PUBLIC_PROJECT_URL` | client | Recomendada em prod | vazio (`''`) | **CORS**: quando definida, as rotas partner liberam **só** essa origem (`lib/server/cors.ts`); sem ela nenhum `Access-Control-Allow-Origin` é emitido (same-origin funciona; cross-origin é negado). |

## Stellar

| Variável | Escopo | Obrigatória | Default | O que faz / se faltar |
|---|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | client | Não | `PUBLIC` | Rede Stellar (`PUBLIC`/`TESTNET`) (`lib/chains/stellar/stellarConfig.ts`). Define o `STELLAR_PASSPHRASE` usado ao assinar/enviar. |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | client | Não | `https://horizon.stellar.org` (PUBLIC) / `https://horizon-testnet.stellar.org` (TESTNET) | Endpoint Horizon usado para ler contas/saldos e submeter transações. |

## Sessão do app (prova-de-posse) - server-only

| Variável | Escopo | Obrigatória | Default | O que faz / se faltar |
|---|---|---|---|---|
| **`APP_SESSION_SECRET`** | server | **Sim em produção** / opcional em dev | - | Segredo HS256 do token de sessão de carteira (login por prova-de-posse Stellar) em `lib/server/partnerSession.ts`. Mín. **16 chars**. Quando definido, **ativa o modo seguro**: as rotas de cash-in/out exigem a sessão e derivam o `sender` dela (fecha o **BUG-H3 / IDOR**). **Em produção, faltando/curto → o boot é derrubado pelo preflight** (ver ⚠️ no topo). Em dev, faltando → modo legado com warning. |

## Rate-limit / identificação de IP - server-only

O rate-limit (`lib/server/rateLimit.ts`) é a única defesa das rotas anônimas; para não confiar num
`X-Forwarded-For` spoofável (**BUG-M1**), configure conforme sua borda:

| Variável | Escopo | Obrigatória | Default | O que faz / se faltar |
|---|---|---|---|---|
| `TRUSTED_CLIENT_IP_HEADER` | server | Não (recomendada em prod) | - | Header autoritativo de IP da sua borda (ex.: `cf-connecting-ip`, `x-vercel-forwarded-for`, `x-real-ip`). Se definido, **vence** os demais. Sem ele, cai na estratégia de `TRUSTED_PROXY_COUNT`. |
| `TRUSTED_PROXY_COUNT` | server | Não | `1` | Nº de proxies confiáveis à frente do app; o IP é lido dessa posição a partir da **direita** do XFF (1 = a entrada mais à direita). Se o XFF for mais curto que esse número, o valor é ignorado (fail-safe) e cai no `x-real-ip`. |

> Sem nenhuma das duas, o rate-limit ainda funciona, mas a identificação de IP atrás de proxy fica
> imprecisa (pode agrupar clientes ou ser contornada). Não derruba o boot.

## PagFinance Partner API - server-only

Ver detalhes de auth/fluxos em [`04-partner-api.md`](04-partner-api.md). O segredo HMAC **nunca** vai
ao browser: só `app/api/partner/*` o usa para assinar e mintar o JWT do usuário.

| Variável | Escopo | Obrigatória | Default | O que faz / se faltar |
|---|---|---|---|---|
| **`PARTNER_API_BASE_URL`** | server | **Sim** (p/ fluxos partner) | `https://sandbox.brlp.io` (no `.env.example`) | Base URL da partner-api (barra final removida). Sem ela → 503. Errada/inalcançável → **502** nas rotas que chamam o upstream. |
| **`PARTNER_ID`** | server | **Sim** (p/ fluxos partner) | - | Identidade HMAC do parceiro (entregue na criação/rotação). Sem ela → 503. |
| **`PARTNER_RAW_SECRET`** | server | **Sim** (p/ fluxos partner) | - | Segredo HMAC do parceiro. **Server-only, jamais no browser.** Sem ele → 503. |
| `PARTNER_APP_NAME` | server | Não | `PagFinance` | Header `x-app-name` enviado nos endpoints de **quote** (cash-in e cash-out). O middleware de cotação do parceiro exige o contexto do app. |
| `PARTNER_APP_VERSION` | server | Não | `1.0.0` | Header `x-app-version` (idem). |
| `PARTNER_APP_DOMAIN` | server | Não | `pag.finance` | Header `x-app-domain` (idem). |
| `PARTNER_JWT_TTL_SECONDS` | server | Não | default da API (7d) | TTL (segundos) do JWT que mintamos por usuário. Comentado no `.env.example`. |

> **`configured` = true** só quando `PARTNER_API_BASE_URL` **e** `PARTNER_ID` **e** `PARTNER_RAW_SECRET`
> estão presentes (`getPartnerConfig()`). Faltando qualquer uma, o `partnerClient` lança
> `PartnerNotConfiguredError` e as rotas respondem **503**.

---

## Mapa rápido: status HTTP → causa provável (rotas partner)

| Status | Significado | Env provável |
|---|---|---|
| **500 em todas as rotas** | Boot não inicializou | `APP_SESSION_SECRET` ausente/curto em produção |
| **503** "Partner API não configurada" | `configured=false` | Falta `PARTNER_API_BASE_URL` / `PARTNER_ID` / `PARTNER_RAW_SECRET` |
| **502** "Falha ao contatar a Partner API" | upstream inalcançável | `PARTNER_API_BASE_URL` errada / rede |
| **500** só nas rotas que chamam upstream (mas `/api/partner/session` responde) | upstream retornando 500 | Problema na partner-api, não no env local |
