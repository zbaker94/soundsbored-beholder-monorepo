import { defineConfig } from 'vite';
import path from 'node:path';

// Bundle the workspace libs from source (like the listener) and livekit-client
// into a single browser ESM that Foundry loads via module.json `esmodules`.
export default defineConfig({
  resolve: {
    alias: {
      '@soundsbored/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
      '@soundsbored/contract': path.resolve(import.meta.dirname, '../contract/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/module.ts'),
      formats: ['es'],
      fileName: () => 'scripts/soundsbored-foundry.js',
    },
    rollupOptions: {
      // Foundry provides no bare modules at runtime — bundle everything.
      external: [],
    },
  },
});
