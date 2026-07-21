import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // react() forces the automatic JSX runtime for .tsx specs regardless of ambient tsconfig
  // discovery — needed because combine/tsconfig.json is intentionally an inert `{ files: [] }`
  // (no project references), so tools that resolve "which tsconfig applies to this file" via the
  // references graph can't find tsconfig.web.json's `"jsx": "react-jsx"` from it. Scoped to .tsx
  // only, so this has no effect on core/main/cli's plain .ts node-environment tests.
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 20000,
    hookTimeout: 20000
  }
})
