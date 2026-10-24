import { defineConfig } from "vitest/config";

// helper 独立 vitest 配置（纪律：不并入 dsh-plugin 的 coverage 口径——GUI 胶水不进 business core
// 门禁，bridge 契约/状态机纯逻辑测试跑通即可，故无 coverage thresholds）。
// 用 node 环境而非 happy-dom：契约测试起真 stdio 子进程，renderer（vanilla TS）不进 CI。
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.spec.ts"],
    // 契约/生命周期测试起子进程（含 --host-pid 轮询 2s 间隔），给足余量
    testTimeout: 20_000,
    hookTimeout: 10_000,
  },
});
