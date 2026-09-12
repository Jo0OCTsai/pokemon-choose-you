import { expect, test } from "@playwright/test";
import { installTauriMock, task } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

/** 本地今天 09:00 的 due 值（冒险页 = 进行中 + 当天到期含逾期） */
function dueToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}T09:00`;
}

test.describe("图鉴机主面板", () => {
  test("加载后显示六个菜单与今日捕捉进度", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".menu-btn")).toHaveCount(6);
    await expect(page.locator(".menu-btn").first()).toContainText("冒险");
    await expect(page.locator(".catch-progress .px")).toContainText("CAUGHT 0/0");
  });

  test("添加任务出现在列表，编号与分类徽章正确", async ({ page }) => {
    await page.goto("/");
    await page.locator("form.add input").fill("端到端捕捉的任务");
    await page.locator("form.add button[type=submit]").click();
    // 未设截止时间 → 草丛（新建任务去向由是否设置时间决定）
    await page.locator(".menu-btn", { hasText: "草丛" }).click();
    const entry = page.locator(".entry").first();
    await expect(entry).toContainText("端到端捕捉的任务");
    await expect(entry.locator(".dex-no")).toHaveText("No.001");
    await expect(entry.locator(".badge")).toHaveText("工作");
  });

  test("完成任务进入图鉴，进度条同步", async ({ page }) => {
    await installTauriMock(page, {
      tasks: [
        task({ id: 1, title: "第一个任务", status: "scheduled", dueAt: dueToday() }),
        task({ id: 2, title: "第二个任务", status: "scheduled", dueAt: dueToday() }),
      ],
    });
    await page.goto("/");
    await expect(page.locator(".entry")).toHaveCount(2);
    await page.locator(".entry", { hasText: "第一个任务" }).locator(".btn", { hasText: "✔" }).click();
    await expect(page.locator(".entry")).toHaveCount(1);
    await expect(page.locator(".catch-progress .px")).toContainText("CAUGHT 1/2");

    await page.locator(".menu-btn", { hasText: "图鉴" }).click();
    await expect(page.locator(".entry")).toHaveCount(1);
    await expect(page.locator(".entry")).toContainText("已捕捉");
  });

  test("出发任务进入专注态（唯一 active）", async ({ page }) => {
    await installTauriMock(page, {
      tasks: [task({ id: 1, title: "专注目标", status: "scheduled", dueAt: dueToday() })],
    });
    await page.goto("/");
    await page.locator(".entry .btn", { hasText: "出发" }).click();
    await expect(page.locator(".entry")).toHaveCount(1);
    await expect(page.locator(".entry.active")).toContainText("捕获中");
  });

  test("设置里切换语言，界面即时切英文", async ({ page }) => {
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "设置" }).click();
    await page.locator(".stab", { hasText: "显示" }).click();
    // 语言 DexSelect：默认简体中文
    const langRow = page.locator(".set-card label", { hasText: "语言" });
    await langRow.locator(".ds-btn").click();
    await langRow.locator(".ds-list li", { hasText: "English" }).click();
    await expect(page.locator(".menu-btn").first()).toContainText("Adventure");
    await expect(page.locator(".stab", { hasText: "Display" })).toBeVisible();
  });

  test("收音机空态展示引导文案", async ({ page }) => {
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "收音机" }).click();
    await expect(page.locator(".im-list .empty")).toContainText("收音机里很安静");
  });
});
