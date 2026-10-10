import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered by hand in index.html so the page reloads once when a new worker takes over.
      injectRegister: null,
      includeAssets: ["favicon.svg", "fonts/*.woff2", "robots.txt"],
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
        // A new worker takes over on its first load instead of waiting for every tab to close;
        // without this a deploy stayed invisible to returning visitors until a second reload.
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,json,geojson,woff,woff2}"],
        // Flood chunks load on demand per map view, so cache them as they are fetched, not on install.
        // index.html is not precached: online, the page itself is always fetched fresh (NetworkFirst below),
        // so a deploy shows on the next visit; offline, the last fetched copy still serves.
        globIgnores: ["**/data/flood/**", "**/index.html"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "pages", networkTimeoutSeconds: 3 },
          },
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
