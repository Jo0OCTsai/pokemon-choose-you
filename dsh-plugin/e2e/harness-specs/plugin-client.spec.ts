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
  await expect(page.getByText("dsh-ssh 家族").first()).toBeVisible();
  await page.screenshot({
    path: join(here, "../../../specs/dsh-plugin-full-parity/reports/screenshots/e2e-06-diagnostics.png"),
    fullPage: true,
  });
});
