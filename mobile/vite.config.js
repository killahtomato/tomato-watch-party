import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  base: '/m/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tomato Watch Party',
        short_name: 'Tomato Party',
        description: 'Watch movies and DJ sets together with friends.',
        start_url: '/m/',
        scope: '/m/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0d0d0f',
        theme_color: '#0d0d0f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/m/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mobile-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@client': resolve(__dirname, '../client/src'),
    },
  },
  server: {
    port: 5174,
    fs: { allow: [resolve(__dirname, '..')] },
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
      '/stream': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
  },
});
