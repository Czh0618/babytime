import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // 本机联调同步服务：BABYTIME_SYNC_ALLOW_HTTP=1 node server/sync.ts
    proxy: { "/sync/": "http://127.0.0.1:8787" },
  },
});
