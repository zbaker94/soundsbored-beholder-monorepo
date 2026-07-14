import { defineConfig } from 'vite';
import path from 'node:path';

// Bundle the workspace libs from source so the listener builds without a
// prior `tsc` emit of core/contract.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@soundsbored/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
      '@soundsbored/contract': path.resolve(
        import.meta.dirname,
        '../contract/src/index.ts',
      ),
    },
  },
});
