import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  // Crucial for university LAMP server hosting from a subdirectory:
  base: './',
  plugins: [
    wasm(),
    topLevelAwait(),
    glsl({
      include: [
        '**/*.glsl', '**/*.vert',
        '**/*.frag', '**/*.vs', '**/*.fs'
      ],
      compress: false,
      watch: true
    })
  ],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    target: 'esnext'
  }
});
