import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Espelha o path alias do tsconfig (@/* → raiz do projeto).
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` lança em bundle client; nos testes usamos um no-op.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
})
