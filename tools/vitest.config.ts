import { defineConfig } from 'vitest/config';

// Outils lancés à la demande (export des répliques, diagnostic du pilote automatique).
export default defineConfig({
  test: { include: ['tools/**/*.test.ts'], testTimeout: 300000 },
});
