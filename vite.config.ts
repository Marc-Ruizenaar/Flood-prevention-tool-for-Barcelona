import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // The Python model in ml/ has its own venv; its files must not trigger page reloads.
  server: { watch: { ignored: ["**/ml/**"] } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Next rain — Barcelona",
        short_name: "Next rain",
        description: "Published flood geography for Barcelona.",
        theme_color: "#142028",
        background_color: "#142028",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,json,geojson,woff,woff2}"],
        // Flood chunks load on demand per map view, so cache them as they are fetched, not on install.
        globIgnores: ["**/data/flood/**"],
        runtimeCaching: [
          {
            urlPattern: /\/data\/flood\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "flood",
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "basemap",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            urlPattern: /^https:\/\/geoserveis\.icgc\.cat\/servei\/catalunya\/contextmaps-terreny-5m-rgb\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "terrain",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
});
