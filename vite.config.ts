import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Plusieurs pages : le jeu (index) et les pages de test (showcase…).
// BASE_PATH : sous-dossier de publication (ex. « /altara/ » sur GitHub Pages),
// fourni par le workflow de déploiement ; « / » en local.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        showcase: resolve(__dirname, 'showcase/index.html'),
      },
    },
  },
});
