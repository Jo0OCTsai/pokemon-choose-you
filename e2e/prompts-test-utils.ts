import { expect, type Locator, type Page } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

/**
 * 「AI 提示词」卡 E2E 共享工具（prompts-settings.spec.ts 功能用例与
 * prompts-screenshots.spec.ts 验收叙事截图共用）：入口导航、卡/面板定位、
 * mock invoke 读回、编辑态进入。
 */

export const IM_PANEL = "IM 分类";
export const CAPTURE_PANEL = "快速捕捉";
export const PET_PANEL = "桌宠对话";
export const TAG_PANEL = "标签治理";
export const DISPATCH_PANEL = "待办派发";

export async function openPrompts(page: Page, settings: Record<string, string> = {}) {
  await installTauriMock(page, { settings });
  await page.goto("/");
  await page.locator(".menu-btn", { hasText: "背包" }).click();
  await page.locator(".stab", { hasText: "Agent" }).click();
}

export function card(page: Page): Locator {
  return page.locator(".set-card", { hasText: "AI 提示词" });
}

/** 按功能名定位折叠面板并展开（等 5 面板就绪） */
export async function expandPanel(page: Page, name: string): Promise<Locator> {
  await expect(card(page).locator(".panel")).toHaveCount(5);
  const panel = card(page).locator(".panel", { hasText: name });
  await panel.locator(".panel-head").click();
  return panel;
}

export function mockInvoke(page: Page, cmd: string, args: Record<string, unknown> = {}) {
  return page.evaluate(([c, a]) => (window as any).__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
}

/** 读回某功能的当前 spec（后端状态断言用） */
export function readSpec(page: Page, id: string) {
  return mockInvoke(page, "list_ai_prompt_specs").then((specs: any[]) => specs.find((s) => s.id === id) ?? null);
}

/** 进入编辑态并返回 textarea 定位 */
export async function startEdit(panel: Locator): Promise<Locator> {
  await panel.locator(".act-row .btn", { hasText: "编辑" }).click();
  return panel.locator("textarea.prompt-editor");
}

/** 首次 list_ai_prompt_specs 拒绝（模拟读取故障）；其余命令透传原 mock */
export async function failFirstListSpecs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const orig = internals.invoke.bind(internals);
    let failed = false;
    internals.invoke = (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_ai_prompt_specs" && !failed) {
        failed = true;
        return Promise.reject({ kind: "db", message: "数据库错误: mock（E2E）", retryable: false });
      }
      return orig(cmd, args);
    };
  });
}
