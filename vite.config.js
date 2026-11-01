import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The deferred TensorFlow.js CPU runtime is intentionally larger than a typical UI chunk.
    chunkSizeWarningLimit: 600,
  },
});
