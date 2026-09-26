import { expect, test } from "@playwright/test";
import { installTauriMock, chatMessage, task } from "./tauri-mock";

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
  test("加载后显示七个菜单与今日捕捉进度", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".menu-btn")).toHaveCount(7);
    await expect(page.locator(".menu-btn").first()).toContainText("冒险");
    await expect(page.locator(".catch-progress .px")).toContainText("CAUGHT 0/0");
  });

  test("日志页：会话历史抽为顶层菜单，空库渲染空态", async ({ page }) => {
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "日志" }).click();
    await expect(page.locator(".dex-main-head h1")).toContainText("日志");
    // 列表分页/过滤/回放行为由 AgentSessionHistory 单测覆盖，这里只钉导航与空态
    await expect(page.locator(".sess-filters")).toBeVisible();
    await expect(page.locator(".sess-empty")).toContainText("还没有会话记录");
  });

  test("收音机快速捕捉：一句话经 AI 判定建待办，出现在草丛", async ({ page }) => {
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "收音机" }).click();
    await page.locator(".cap-input").fill("端到端捕捉的任务");
    await page.locator(".capture-bar button[type=submit]").click();
    await expect(page.locator(".toast")).toContainText("No.1");
    // 未识别到截止时间 → 草丛
    await page.locator(".menu-btn", { hasText: "草丛" }).click();
    const entry = page.locator(".entry").first();
    await expect(entry).toContainText("端到端捕捉的任务");
    await expect(entry.locator(".dex-no")).toHaveText("No.001");
    await expect(entry.locator(".badge")).toHaveText("工作");
  });

  test("逃走原因弹层：向上弹出完整落在视口内，遮罩不吞点击、原因码随逃走落库", async ({ page }) => {
    await installTauriMock(page, {
      chatMessages: [chatMessage({ id: 7, content: "明天上午10点开周会", suggestedTitle: "参加周会" })],
    });
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "收音机" }).click();
    await page.locator(".er-toggle").click();
    const pop = page.locator(".escape-pop");
    await expect(pop).toBeVisible();
    // 回归 1：弹层不再向下溢出窗口底部（向上弹出 + 限高兜底）
    const box = (await pop.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // 回归 2：点击选项要真的命中按钮（弹层背板不得盖住选项吞掉点击）
    await pop.locator(".er-chip", { hasText: "闲聊/噪音" }).click();
    await expect(page.locator(".toast")).toContainText("已逃走");
    // 原因码随消息行落库：已逃走详情亮出「AI 原判 + 原因」
    await page.locator('[data-group="escaped"] .lg-head').click(); // 已逃走默认收起
    await page.locator('[data-group="escaped"] .rrow').first().click();
    const banner = page.locator(".dim-banner");
    await expect(banner).toContainText("AI 原判");
    await expect(banner).toContainText("有待办信号");
    await expect(banner).toContainText("闲聊/噪音");
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
    await page.locator(".menu-btn", { hasText: "背包" }).click();
    await page.locator(".stab", { hasText: "显示" }).click();
    // 语言 DexSelect：默认简体中文（SettingRow 渲染为 .set-row > .set-label）
    const langRow = page.locator(".set-card .set-row", { hasText: "语言" });
    await langRow.locator(".ds-btn").click();
    await langRow.locator(".ds-list li", { hasText: "English" }).click();
    await expect(page.locator(".menu-btn").first()).toContainText("Adventure");
    await expect(page.locator(".stab", { hasText: "Display" })).toBeVisible();
  });

  test("收音机空态展示引导文案", async ({ page }) => {
    await page.goto("/");
    await page.locator(".menu-btn", { hasText: "收音机" }).click();
    await expect(page.locator(".im-list-box .empty")).toContainText("收音机里很安静");
  });
});
