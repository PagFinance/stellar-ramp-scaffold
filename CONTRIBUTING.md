# Contributing

Thanks for contributing to stellar-ramp-scaffold! 
We welcome contributions in the form of issues, pull requests, and discussions. Please read the following guidelines to ensure a smooth collaboration.

## Before opening a PR

Run and keep it green:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

A pre-commit hook (Husky + lint-staged) runs `eslint --fix` + `prettier` on staged files. CI
(GitHub Actions) runs `typecheck → lint → test → build` on every PR.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server (Next) - http://localhost:3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run test` / `test:watch` | Vitest |

## Standards

- **TypeScript strict**; avoid `@ts-ignore` (use real types or `unknown` + narrowing).
  `verbatimModuleSyntax` is on → use `import type` for type-only imports.
- **Prettier is authoritative:** `semi: false`, `singleQuote: true`, `printWidth: 100`,
  `tabWidth: 2`, `trailingComma: all`. Match the style of the file you edit.
- **Secrets:** never in client code. Server-only lives outside `NEXT_PUBLIC_`; server modules use
  `import 'server-only'`. Never commit `.env*`.
- **Tests:** pure logic (helpers, guards, signature verification) and sensitive routes (rate-limit)
  should have tests. `tests/registry.test.ts` enforces that `CHAIN_ORDER` covers the `ChainId` union.
- **Language:** comments and error strings are pt-BR (this is a pt-BR project); identifiers are
  English. Keep a file internally consistent.

## Architecture

See [`CLAUDE.md`](CLAUDE.md) and [`docs/00-overview-and-architecture.md`](docs/00-overview-and-architecture.md).
Core idea: this scaffold is Stellar-exclusive - the Stellar wallet resolves to a single `WalletSlice`
(`lib/types/WalletSlice.ts`), aggregated in `hooks/useWalletWeb3.ts`; the Chain Registry
(`lib/chains/registry.ts`) is the single source of truth for chains.
