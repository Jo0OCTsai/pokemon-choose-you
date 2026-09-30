import { expect, test } from "@playwright/test";
import path from "node:path";
import { DISPATCH_PANEL, IM_PANEL, TAG_PANEL, expandPanel, openPrompts, startEdit } from "./prompts-test-utils";

/**
 * 「AI 提示词」卡验收叙事截图（e2e-acceptance 第二层产物，acceptance-report 引用）：
 * 默认态 / 编辑校验 / 警示态 / 只读面板 / 恢复确认条 / 保存后自定义。功能用例见
 * prompts-settings.spec.ts。
 */

/** 验收叙事截图目录（仅 chromium 工程生成） */
const SHOT_DIR = path.resolve(process.cwd(), "specs/editable-prompts/reports/screenshots");

test.describe("验收叙事截图（acceptance-report 引用）", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "截图产物仅 chromium 工程生成");

  test("默认态 / 编辑校验 / 保存后自定义", async ({ page }) => {
    await openPrompts(page);
    const im = await expandPanel(page, IM_PANEL);
    await expect(im.locator(".lcd.view-lcd")).toContainText("<AGENT_ID>");
    await im.screenshot({ path: path.join(SHOT_DIR, "01-default-view.png") });

    const ta = await startEdit(im);
    await ta.fill("我的分类规则，但删掉了占位符");
    await expect(im.locator(".validation .v-item.v-block")).toContainText("缺少必要占位符");
    await im.screenshot({ path: path.join(SHOT_DIR, "02-edit-validation.png") });
    await im.locator(".chip", { hasText: "<AGENT_ID>" }).click();
    await im.locator(".act-row .btn", { hasText: "保存" }).click();
    await expect(im.locator(".badge.b-custom")).toContainText("自定义");
    await im.locator(".act-row .btn", { hasText: "内置默认对照" }).click();
    await expect(im.locator(".ref-block")).toBeVisible();
    await im.screenshot({ path: path.join(SHOT_DIR, "06-saved-custom.png") });
  });

  test("警示态 / 只读面板 / 恢复确认条", async ({ page }) => {
    await openPrompts(page, {
      ai_prompt_im_classify: "我的分类规则（E2E seed，缺占位符）",
      ai_prompt_tag_health: "我的标签治理规则（E2E seed）",
    });
    const im = await expandPanel(page, IM_PANEL);
    await expect(im.locator(".warn-line")).toContainText("<AGENT_ID>");
    await im.screenshot({ path: path.join(SHOT_DIR, "03-warned-state.png") });

    const disp = await expandPanel(page, DISPATCH_PANEL);
    await expect(disp.locator(".info-line")).toContainText("隔离结构");
    await disp.screenshot({ path: path.join(SHOT_DIR, "04-readonly-dispatch.png") });

    const tag = await expandPanel(page, TAG_PANEL);
    await tag.locator(".act-row .btn", { hasText: "恢复默认" }).click();
    await expect(tag.locator(".confirm-bar")).toContainText("将清除自定义内容");
    await tag.screenshot({ path: path.join(SHOT_DIR, "05-restore-confirm.png") });
  });
});
