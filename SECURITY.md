# Segurança

Este scaffold move dinheiro real (cash-in/out via Pix + transferências on-chain).
Toda decisão de segurança embarcada aqui é herdada por cada fork - leia isto antes
de subir para produção.

## Segredos obrigatórios em produção

O boot faz um **preflight** (`instrumentation.ts` → `assertProductionEnv`) que
**derruba o servidor** quando `NODE_ENV=production` e um segredo obrigatório falta:

| Var | Obrigatória em prod | Efeito se ausente |
|-----|---------------------|-------------------|
| `APP_SESSION_SECRET` (≥16 chars) | **Sim** | Sem ela, as rotas de cash-in/out caem no modo legado que confia no `sender` do cliente → IDOR (BUG-H3). O preflight impede o boot. |
| `PARTNER_*` | Não (mas os fluxos respondem 503 sem elas) | Partner API "não configurada". |

Nunca faça commit de `.env*`, pois contém segredos sensíveis.
O `.env.example` é apenas um modelo de env que contém apenas placeholders.

## Modelo de confiança das rotas `app/api/*`

- **Secrets ficam no servidor.** Módulos que leem segredos começam com
  `import 'server-only'`. Nada sensível vai para `NEXT_PUBLIC_*` (que é inlinado no
  bundle do cliente).
- **Prova de posse de carteira.** As rotas de dinheiro derivam o `sender` da sessão
  assinada (`requireSender` + `lib/server/partnerSession.ts`), não de um campo do
  body. Cliente assina um desafio; o servidor verifica a assinatura Stellar (Ed25519,
  onde o próprio address `G…` é a chave pública) e emite um cookie `httpOnly`.
- **CORS** travado por origem (`NEXT_PUBLIC_PROJECT_URL`), não `*`.
- **Rate-limit** por IP nas rotas anônimas. Configure a identificação de IP para
  não confiar num `X-Forwarded-For` spoofável - ver `TRUSTED_CLIENT_IP_HEADER` /
  `TRUSTED_PROXY_COUNT` no `.env.example`. Garanta que sua borda **reescreve** o XFF
  de entrada. O store é in-memory (scaffold) - use Redis/KV em multi-instância.
- **Security headers** aplicados a todas as respostas (`next.config.mjs`):
  `frame-ancestors 'none'` / `X-Frame-Options: DENY` (anti-clickjacking), HSTS,
  `nosniff`, `Referrer-Policy`.

## Gaps conhecidos (ver `docs/known-issues.md`)

Alguns endurecimentos ainda estão em aberto e documentados lá (ex.: binding de
ownership nas rotas de KYC, single-use do desafio de sessão). Trate-os antes de um
go-live que mova volume relevante.

## Reporte de vulnerabilidades

Reporte de forma privada e coordenada (não abra issue pública para
vulnerabilidades). Contato: **security@pag.finance**. Descreva o impacto e um
passo-a-passo de reprodução; retornaremos com um prazo de correção.
