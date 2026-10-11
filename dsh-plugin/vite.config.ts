import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// vitest 配置以 vite.config.ts 为载体（vitest 原生读取该文件名）：质量棘轮 ② 覆盖率地板的发现口径
// 只扫 <svc>/vite.config.ts 的 thresholds 四维声明（quality_ratchet_check.py RE_VITE_THRESHOLDS），
// 与根服务同构、单一声明源——不要改名为 vitest.config.ts（会脱离棘轮发现面）。
export default defineConfig({
  resolve: {
    alias: {
      // 主应用字典源直引（A16）：client 半边零拷贝复用主应用三语字典 TS 源
      "@app-i18n": resolve(__dirname, "../src/i18n"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["__tests__/**/*.spec.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      // business core 口径（NFR-5）：只统计宿主半边 TS 业务核心（模块挂点 README.md 不入解析）；
      // client 组件与平台胶水不入口径。json-summary 供 CI 写 job summary；lcov 供 Codecov（与前端/Rust 同构）。
      provider: "v8",
      include: ["src/host/**/*.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      // 阈值四维同值（quality_ratchet_check.py ② 覆盖率地板发现口径）；下调须先改棘轮基线
      thresholds: { lines: 85, branches: 85, functions: 85, statements: 85 },
    },
  },
});
