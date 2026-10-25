/**
 * dsh-plugin 客户端面 E2E 配置（与仓根桌面 e2e 分离——testDir/报告落点不同）。
 * 产物：specs/dsh-plugin-full-parity/reports/raw/playwright-report/（HTML）。
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./harness-specs",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../../specs/dsh-plugin-full-parity/reports/raw/playwright-report", open: "never" }],
  ],
  use: {
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
