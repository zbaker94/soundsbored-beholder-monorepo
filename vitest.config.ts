import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@soundsbored/core': path.resolve(
        import.meta.dirname,
        'packages/core/src/index.ts',
      ),
      '@soundsbored/contract': path.resolve(
        import.meta.dirname,
        'packages/contract/src/index.ts',
      ),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
