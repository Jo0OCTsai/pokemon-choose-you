import { defineConfig, devices } from "@playwright/test";

/**
 * E2E：对 Vite dev server 跑浏览器级端到端测试，
 * 通过注入 window.__TAURI_INTERNALS__ mock 掉 Tauri IPC（见 e2e/tauri-mock.ts）。
 * 真机（tauri-driver / WebDriver）测试属于发布前验收，不在此层重复。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // 兼容性测试：同一套用例跑三大引擎（WebKit 对应 macOS 应用实际的 WebKit 行为）
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
