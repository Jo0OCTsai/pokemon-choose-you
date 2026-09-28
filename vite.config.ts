/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue()],

  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      // 胶水排除（口径修正非放水）：api.ts 是 Tauri invoke 薄封装（真实通路由 E2E mock 覆盖）、
      // i18n 三字典是纯数据——均无单测价值；exclude 与 provider 默认排除项合并
      exclude: ["src/api.ts", "src/i18n/en.ts", "src/i18n/zh-Hans.ts", "src/i18n/zh-Hant.ts"],
      // 阈值四维同值（quality_ratchet_check.py ② 覆盖率地板发现口径）；下调须先改棘轮基线
      thresholds: { lines: 65, branches: 65, functions: 65, statements: 65 },
    },
  },

  // 桌宠窗口与主面板各一个入口
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        pet: new URL("./pet.html", import.meta.url).pathname,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
