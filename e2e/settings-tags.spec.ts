import { expect, test, type Locator, type Page } from "@playwright/test";
import { installTauriMock, task } from "./tauri-mock";

/**
 * 设置 → 分类与标签：标签编辑 / 维度迁移与维度管理；项目派发卡片 2026-09 移入
 * 设置 → Agent 分区，相关用例跨分区导航断言联动。后端状态断言直接经 mock 的
 * invoke 读回（与 Rust 命令语义对齐，见 tauri-mock.ts）。
 */

const AGENTS = [
  {
    id: "ag-local",
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "--resume",
    workdir: "",
    timeoutSecs: 120,
    enabled: true,
    remote: null,
  },
  {
    id: "ag-remote",
    name: "Claude Code 2",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "--resume",
    workdir: "",
    timeoutSecs: 120,
    enabled: true,
    remote: { host: "me@server", port: 22, keyPath: "", tunnel: 10022 },
  },
  {
    id: "ag-off",
    name: "OpenCode",
    command: "opencode",
    args: "run {prompt}",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 120,
    enabled: false,
    remote: null,
  },
];

const TAGS = [
  {
    id: 1,
    name: "pokemon-choose-you",
    description: "桌宠待办应用",
    dimension: "project",
    origin: "manual",
    usage: 3,
    createdAt: "2026-08-01T08:00:00Z",
    meta: { workdir: "~/projects/pokemon-choose-you", agentId: "ag-remote", context: "Tauri 2 + Vue 3" },
  },
  {
    id: 2,
    name: "lark-mcp",
    description: "",
    dimension: "project",
    origin: "ai",
    usage: 1,
    createdAt: "2026-08-02T08:00:00Z",
    meta: null,
  },
  {
    id: 3,
    name: "读书",
    description: "阅读",
    dimension: "topic",
    origin: "manual",
    usage: 0,
    createdAt: "2026-08-03T08:00:00Z",
    meta: null,
  },
];

const SETTINGS = { ai_agents: JSON.stringify(AGENTS), ai_agent_id: "ag-local" };

async function openTagsSettings(page: Page) {
  await page.goto("/");
  await page.locator(".menu-btn", { hasText: "背包" }).click();
  await page.locator(".stab", { hasText: "分类与标签" }).click();
  // 标签与维度由同一个 store.load 带回，分组渲染齐即就绪
  await expect(page.locator(".tag-dim-group")).toHaveCount(4);
}

/** 项目派发卡片在 Agent 分区：切过去（agent 列表就绪即卡片可断言） */
async function openAgentsStab(page: Page) {
  await page.locator(".stab", { hasText: "Agent" }).click();
}

function dispatchCard(page: Page): Locator {
  return page.locator(".set-card", { hasText: "项目派发" });
}

/** 标签名是输入框的值而非文本，按值扫描定位所在行 */
async function findTagRow(page: Page, name: string): Promise<Locator> {
  const rows = page.locator(".tag-row").filter({ has: page.locator(".tag-name") });
  await expect(async () => {
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      if ((await rows.nth(i).locator(".tag-name").inputValue()) === name) return;
    }
    throw new Error(`找不到标签行：${name}`);
  }).toPass();
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    if ((await rows.nth(i).locator(".tag-name").inputValue()) === name) return rows.nth(i);
  }
  throw new Error(`找不到标签行：${name}`);
}

function mockInvoke(page: Page, cmd: string, args: Record<string, unknown> = {}) {
  return page.evaluate(([c, a]) => (window as any).__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
}

test.describe("设置 · 标签与项目派发", () => {
  test("标签按维度分组渲染，已配置派发的项目标签带 ⚡ 徽标", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);

    const projectHead = page.locator(".tag-dim-head", { hasText: "项目" });
    await expect(projectHead).toContainText("2/20");
    await expect(projectHead).toContainText("单选");

    const configured = await findTagRow(page, "pokemon-choose-you");
    await expect(configured.locator(".tag-meta-chip")).toBeVisible();
    const unconfigured = await findTagRow(page, "lark-mcp");
    await expect(unconfigured.locator(".tag-meta-chip")).toHaveCount(0);

    // 派发卡片在 Agent 分区：一标签一节，配置状态与 meta 预填跟随种子数据
    await openAgentsStab(page);
    const card = dispatchCard(page);
    await expect(card.locator(".dispatch-block")).toHaveCount(2);
    const block = card.locator(".dispatch-block", { hasText: "pokemon-choose-you" });
    await expect(block.locator(".db-state")).toHaveClass(/on/);
    await expect(block.locator(".ds-btn")).toContainText("Claude Code 2 · SSH");
    await expect(block.locator("input[placeholder='~/projects/my-repo']")).toHaveValue("~/projects/pokemon-choose-you");
    await expect(block.locator("input[placeholder='技术栈、注意事项…']")).toHaveValue("Tauri 2 + Vue 3");
    await expect(card.locator(".dispatch-block", { hasText: "lark-mcp" }).locator(".db-state")).toContainText("未配置");
  });

  test("改标签名与描述并保存后写入后端", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    const row = await findTagRow(page, "读书");
    await row.locator(".tag-name").fill("读书笔记");
    await row.locator(".tag-desc").fill("每周读一章");
    await row.locator(".btn", { hasText: "保存" }).click();

    await expect
      .poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).find((t) => t.id === 3)?.name)
      .toBe("读书笔记");
    await expect
      .poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).find((t) => t.id === 3)?.description)
      .toBe("每周读一章");

    const renamed = await findTagRow(page, "读书笔记");
    await expect(renamed.locator(".tag-desc")).toHaveValue("每周读一章");
  });

  test("把标签从主题挪到项目维度并保存后，Agent 分区的项目派发卡片出现该标签", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    const row = await findTagRow(page, "读书");
    await row.locator(".ds-btn").click();
    await row.locator(".ds-list li", { hasText: "项目" }).click();
    // 维度变更后行移动分组，重新定位再保存
    const moved = await findTagRow(page, "读书");
    await moved.locator(".btn", { hasText: "保存" }).click();

    await expect
      .poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).find((t) => t.id === 3)?.dimension)
      .toBe("project");

    // 派发卡片在 Agent 分区：新挪入的项目标签随 store 刷新出现在路由表
    await openAgentsStab(page);
    const block = dispatchCard(page).locator(".dispatch-block", { hasText: "读书" });
    await expect(block).toHaveCount(1);
    await expect(block.locator(".db-state")).toContainText("未配置");
  });

  test("Agent 分区的项目派发卡片保存 agent 与目录后落库，回分类与标签点亮 ⚡", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    await openAgentsStab(page);
    const block = dispatchCard(page).locator(".dispatch-block", { hasText: "lark-mcp" });
    await block.locator(".ds-btn").click();
    await block
      .locator(".ds-list li")
      .filter({ hasText: /Claude Code$/ })
      .click();
    await block.locator("input[placeholder='~/projects/my-repo']").fill("~/projects/lark-mcp");
    // 改动即时保存：文本失焦（change）即落库，无独立保存按钮
    await block.locator("input[placeholder='~/projects/my-repo']").blur();

    await expect
      .poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).find((t) => t.id === 2)?.meta)
      .toEqual({ workdir: "~/projects/lark-mcp", agentId: "ag-local", context: null });

    await expect(block.locator(".db-state")).toContainText("已配置");
    // ⚡ 徽标跟随 tagsStore（即时保存后即点亮）：回分类与标签分区核对
    await page.locator(".stab", { hasText: "分类与标签" }).click();
    const row = await findTagRow(page, "lark-mcp");
    await expect(row.locator(".tag-meta-chip")).toBeVisible();
  });

  test("删除项目标签后，行与 Agent 分区的派发小节一起消失，任务关联同步清理", async ({ page }) => {
    await installTauriMock(page, {
      settings: SETTINGS,
      tags: TAGS,
      tasks: [task({ id: 1, title: "改 bug", tags: [{ name: "pokemon-choose-you", dimension: "project" }] })],
    });
    await openTagsSettings(page);
    const row = await findTagRow(page, "pokemon-choose-you");
    await row.locator(".btn.del").click();

    // 行内 ⚡ 同步消失；派发小节在 Agent 分区，切换后按 store 现量断言
    await expect(page.locator(".tag-meta-chip")).toHaveCount(0);
    await openAgentsStab(page);
    await expect(dispatchCard(page).locator(".dispatch-block")).toHaveCount(1);
    await expect.poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).map((t) => t.id)).toEqual([2, 3]);
    // 任务上的标签引用随删除级联清理
    await expect.poll(async () => ((await mockInvoke(page, "list_tasks")) as any[])[0]?.tags).toEqual([]);
  });

  test("在项目维度新建标签，新行与后端记录同时出现", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    await page.locator(".tag-dim-head", { hasText: "项目" }).locator(".btn").click();

    const row = await findTagRow(page, "新标签");
    await expect(row.locator(".ds-btn")).toContainText("项目");
    await expect(page.locator(".tag-dim-head", { hasText: "项目" })).toContainText("3/20");
    await expect
      .poll(async () => ((await mockInvoke(page, "list_tags")) as any[]).find((t) => t.name === "新标签")?.dimension)
      .toBe("project");
  });

  test("维度改名与上限调整保存后落库", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    // 维度行的名称在输入框里，按展示的 key 文本（dim-key）定位
    const dimRow = page.locator(".dim-row", { hasText: "topic" });
    await dimRow.locator(".tag-name").fill("兴趣圈");
    await dimRow.locator(".dim-max").fill("15");
    await dimRow.locator(".btn", { hasText: "保存" }).click();

    await expect
      .poll(async () => ((await mockInvoke(page, "list_tag_dimensions")) as any[]).find((d) => d.key === "topic"))
      .toEqual(expect.objectContaining({ name: "兴趣圈", maxTags: 15 }));
  });

  test("新增维度后出现在维度列表与分组（非 ascii 名称回落 dim-N key）", async ({ page }) => {
    await installTauriMock(page, { settings: SETTINGS, tags: TAGS });
    await openTagsSettings(page);
    await page.getByPlaceholder("新维度名称").fill("心情");
    await page.locator(".btn", { hasText: "新维度" }).click();

    await expect
      .poll(async () => ((await mockInvoke(page, "list_tag_dimensions")) as any[]).find((d) => d.name === "心情"))
      .toEqual(expect.objectContaining({ cardinality: "single", maxTags: 20 }));
    await expect
      .poll(async () => ((await mockInvoke(page, "list_tag_dimensions")) as any[]).find((d) => d.name === "心情")?.key)
      .toMatch(/^dim-/);
    await expect(page.locator(".tag-dim-head", { hasText: "心情" })).toBeVisible();
  });
});
