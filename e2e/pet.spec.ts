import { expect, test } from "@playwright/test";
import { installTauriMock, task } from "./tauri-mock";

test.describe("桌宠窗口", () => {
  test("无任务时显示欢迎气泡与默认精灵", async ({ page }) => {
    await installTauriMock(page, { windowLabel: "pet" });
    await page.goto("/pet.html");
    await expect(page.locator(".dialog-text")).toHaveText("今天想捕捉哪只宝可梦？悬停打开快捷图鉴屏吧！");
    await expect(page.locator(".pet-sprite")).toHaveAttribute("src", "/pokemon/pikachu.gif");
    await expect(page.locator(".pomo-pill")).toBeHidden();
  });

  test("有进行中任务时显示专注状态与番茄钟", async ({ page }) => {
    await installTauriMock(page, {
      windowLabel: "pet",
      tasks: [task({ id: 1, title: "桌宠正在捕捉", status: "active" })],
    });
    await page.goto("/pet.html");
    await expect(page.locator(".dialog-text")).toContainText("正在捕捉：桌宠正在捕捉");
    await expect(page.locator(".pomo-pill")).toBeVisible();
    await expect(page.locator(".pomo-pill .px")).toContainText("25:00");
  });

  test("点悬停浮现的 ☰ 钮展开快捷图鉴屏，双击列表项直接出发", async ({ page }) => {
    await installTauriMock(page, {
      windowLabel: "pet",
      tasks: [
        task({ id: 1, title: "当前任务", status: "active" }),
        task({ id: 2, title: "快捷屏备选", status: "scheduled" }),
      ],
    });
    await page.goto("/pet.html");
    // ☰ 钮平时隐身（悬停精灵才浮现），直接派发点击事件绕过显隐
    await page.locator(".quick-fab").dispatchEvent("click");
    const quick = page.locator(".quick-dex");
    await expect(quick).toBeVisible();
    await expect(quick.locator(".q-item")).toHaveCount(2);
    await expect(quick.locator(".q-item", { hasText: "快捷屏备选" })).toBeVisible();

    // 双击备选项 → 切换专注目标，气泡喊"就决定是你了"
    await quick.locator(".q-item", { hasText: "快捷屏备选" }).dblclick();
    await expect(page.locator(".dialog-text")).toContainText("就决定是你了！快捷屏备选");
  });

  test("暂停当前任务后回到待机", async ({ page }) => {
    await installTauriMock(page, {
      windowLabel: "pet",
      tasks: [task({ id: 1, title: "暂停我", status: "active" })],
    });
    await page.goto("/pet.html");
    await page.locator(".pomo-btn", { hasText: "⏸" }).click();
    // 后端无 active 任务 → 桌宠回到待机文案，番茄钟收起
    await expect(page.locator(".dialog-text")).toContainText("今天的冒险还没开始");
    await expect(page.locator(".pomo-pill")).toBeHidden();
  });

  test("快捷屏未选目标点出发，气泡提示先选目标", async ({ page }) => {
    await installTauriMock(page, { windowLabel: "pet" });
    await page.goto("/pet.html");
    await page.locator(".quick-fab").dispatchEvent("click");
    const quick = page.locator(".quick-dex");
    await expect(quick).toBeVisible();
    await quick.locator(".ops .btn", { hasText: "出发" }).click();
    await expect(page.locator(".dialog-text")).toContainText("选一个捕捉目标吧");
  });

  test("双击精灵请求打开主窗口，且不闪出快捷屏", async ({ page }) => {
    await installTauriMock(page, { windowLabel: "pet" });
    await page.goto("/pet.html");
    await page.locator(".pet-sprite").dispatchEvent("dblclick");
    await expect(page.locator(".quick-dex")).toBeHidden();
    await page.waitForFunction(() => (window as any).__mainOpened === 1);
  });
});
