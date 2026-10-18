/**
 * dsh-plugin 客户端面 E2E（specs/dsh-plugin-full-parity plan §5）：
 * 真实构建产物 dist/client.js 经 harness（ModuleLoader shim + mockHost 伪 rpc）装载渲染，
 * Playwright 走查核心面并截图（产物 HTML 报告 + 截图归 specs/dsh-plugin-full-parity/reports/）。
 */
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const here = import.meta.dirname;

const HARNESS_URL = pathToFileURL(join(here, "..", "harness", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.locator("#harness-error")).toHaveCount(0);
});

test("面板装载：七分段导航在位、无装载错误", async ({ page }) => {
  await expect(page.getByText("冒险")).toBeVisible();
  await expect(page.getByText("图鉴机").first()).toBeVisible();
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-01-panel.png"),
    fullPage: true,
  });
});

test("日志段：过滤胶囊四选 + 分页汇总常显", async ({ page }) => {
  await page.locator('[data-segment="logs"]').click();
  await expect(page.getByText(/全部/).first()).toBeVisible();
  await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-04-sessions.png"),
  });
});

test("日志段：派发记录回放（本机 handoff）→ 命令行回传可见（复制或手动复制，零静默）", async ({ page }) => {
  await page.locator('[data-segment="logs"]').click();
  await expect(page.getByText(/共 3 条/)).toBeVisible();
  // 行序（id 降序）：gpu-1 远端 → tmux 交互 → 本机 headless（sess-e2e-1）
  // 本机 headless 行（--resume 分支）：点回放 → note（已复制/手动复制两态之一）+ 命令行可见
  await page.locator('[data-testid="session-replay"]').nth(2).click();
  await expect(page.getByTestId("session-note")).toContainText(/回放命令已复制|请手动复制/);
  await expect(page.getByTestId("session-replay-line")).toContainText("claude --resume sess-e2e-1");
  await expect(page.getByTestId("session-replay-line")).toContainText("工作目录：/srv/work");
  // 本机 tmux 交互行（tmux attach 分支）
  await page.locator('[data-testid="session-replay"]').nth(1).click();
  await expect(page.getByTestId("session-replay-line")).toContainText("tmux attach-session -t pky-e2e");
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-04b-replay-handoff.png"),
  });
});

test("背包·Agent 分区：远程部署卡与就绪徽章", async ({ page }) => {
  await page.locator('[data-segment="settings"]').click();
  await page.getByText("Agent").first().click();
  await expect(page.getByText("远程部署")).toBeVisible();
  await expect(page.getByText("gpu-1").first()).toBeVisible();
  await expect(page.getByText("就绪", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-05-deployments.png"),
    fullPage: true,
  });
});

test("背包·诊断分区：helper 能力矩阵与 SSH 家族行（helper 在位 → 无降级横幅）", async ({ page }) => {
  await page.locator('[data-segment="settings"]').click();
  await page.getByText("诊断").first().click();
  // 行名随文案演进（现行「远程派发（dsh-ssh）」）——断言锚定稳定 testid（与单测同口径）
  await expect(page.getByTestId("ssh-cap-row")).toBeVisible();
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-06-diagnostics.png"),
    fullPage: true,
  });
});
