import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";
import {
  CAPTURE_PANEL,
  DISPATCH_PANEL,
  IM_PANEL,
  PET_PANEL,
  TAG_PANEL,
  card,
  expandPanel,
  failFirstListSpecs,
  openPrompts,
  readSpec,
  startEdit,
} from "./prompts-test-utils";

/**
 * 设置 → Agent 分区「AI 提示词」卡（editable-prompts）功能 E2E：查看默认态 /
 * 编辑保存 / 校验阻断与 chip 修复 / 未知占位符警告 / 恢复默认两步确认 / 派发只读 /
 * default_warned 警示态 / 读取失败重试 / 焦点管理（UIUX §4.1）。后端状态断言经
 * mock 的 invoke 读回（解析/校验镜像 Rust ai/prompt_overrides.rs，见 tauri-mock.ts）；
 * 「下一次调用生效」的载荷断言归 cargo test 集成层（E2E 无真实调用管道）。
 * 验收叙事截图用例见 prompts-screenshots.spec.ts。
 */

test.describe("设置 · AI 提示词 · 查看与只读", () => {
  test("默认态查看：徽章、生效标签、占位符行；空集不渲染", async ({ page }) => {
    await openPrompts(page);
    await expect(card(page).locator("h3")).toHaveText("AI 提示词");

    const im = await expandPanel(page, IM_PANEL);
    await expect(im.locator(".badge.b-default")).toContainText("内置默认");
    await expect(im.locator(".lcd-tag")).toHaveText("当前生效");
    await expect(im.locator(".lcd.view-lcd")).toContainText("<AGENT_ID>");
    await expect(im.locator(".lcd.view-lcd")).toContainText("pk suggest batch");
    await expect(im.locator(".ph-row")).toBeVisible();
    await expect(im.locator(".ph-label")).toContainText("必要占位符");
    await expect(im.locator(".chip")).toHaveText(["<AGENT_ID>"]);

    // 标签治理占位符为空集 → 占位符行不渲染；未配置 agent 也无门槛提示
    const tag = await expandPanel(page, TAG_PANEL);
    await expect(tag.locator(".ph-row")).toHaveCount(0);
    await expect(card(page)).not.toContainText("先去配置");
  });

  test("派发提示词只读：无编辑入口、只读说明与示例渲染", async ({ page }) => {
    await openPrompts(page);
    const disp = await expandPanel(page, DISPATCH_PANEL);
    await expect(disp.locator(".badge.b-readonly")).toContainText("只读");
    await expect(disp.locator(".act-row .btn")).toHaveCount(0);
    await expect(disp.locator(".info-line")).toContainText("隔离结构");
    await expect(disp.locator(".lcd.view-lcd")).toContainText("===== 待办数据开始 =====");
    await expect(disp.locator(".lcd.view-lcd")).toContainText("示例：整理周会纪要");
    await expect(disp.locator(".ph-row")).toHaveCount(0);
  });
});

test.describe("设置 · AI 提示词 · 编辑保存", () => {
  test("编辑保存后徽章切换、生效文本替换，可展开内置默认对照", async ({ page }) => {
    await openPrompts(page);
    const pet = await expandPanel(page, PET_PANEL);
    const ta = await startEdit(pet);

    // 编辑预填生效文本（无覆盖时 = 内置默认，两个占位符字面可见）
    const base = await ta.inputValue();
    expect(base).toContain("<CONTEXT>");
    expect(base).toContain("<QUESTION>");
    await ta.fill(base + "\n补充：语气更皮一点。");
    await expect(pet.locator(".badge.b-unsaved")).toContainText("未保存");
    await pet.locator(".act-row .btn", { hasText: "保存" }).click();

    await expect(pet.locator(".badge.b-custom")).toContainText("自定义");
    await expect(pet.locator(".lcd-tag")).toHaveText("当前生效 · 自定义");
    await expect(pet.locator(".lcd.view-lcd")).toContainText("语气更皮一点");
    await expect(pet.locator(".ok-line")).toContainText("已保存");
    await expect.poll(() => readSpec(page, "pet_chat").then((s: any) => s?.source)).toBe("custom");

    // 内置默认对照（仅非默认态出现）：展开显示当前版本编译默认
    await pet.locator(".act-row .btn", { hasText: "内置默认对照" }).click();
    await expect(pet.locator(".ref-block")).toBeVisible();
    await expect(pet.locator(".ref-block .lcd")).toContainText("<QUESTION>");
  });

  test("未知占位符仅警告：保存放行并呈现后端返回的警告", async ({ page }) => {
    await openPrompts(page);
    const pet = await expandPanel(page, PET_PANEL);
    const ta = await startEdit(pet);
    const base = await ta.inputValue();
    await ta.fill(`${base}\n额外规则 <FOO>`);
    await pet.locator(".act-row .btn", { hasText: "保存" }).click();

    await expect(pet.locator(".badge.b-custom")).toContainText("自定义");
    await expect(pet.locator(".v-item.v-warn")).toContainText("不认识的占位符：<FOO>");
    await expect(pet.locator(".ok-line")).toContainText("已保存");
  });
});

test.describe("设置 · AI 提示词 · 校验阻断", () => {
  test("删占位符→红色阻断 + 保存禁用；chip 插入恢复后可保存", async ({ page }) => {
    await openPrompts(page);
    const im = await expandPanel(page, IM_PANEL);
    const ta = await startEdit(im);
    await ta.fill("我的分类规则，但删掉了占位符");

    // 占位符行面板级常驻（编辑态不隐藏）；编辑器上方常驻警示条（协议句风险，SDD P1）
    await expect(im.locator(".ph-row")).toBeVisible();
    await expect(im.locator(".editor-warn")).toContainText("误删可能导致判定失败");
    await expect(im.locator(".chip")).toHaveClass(/missing/);
    const save = im.locator(".act-row .btn", { hasText: "保存" });
    await expect(im.locator(".validation .v-item.v-block")).toContainText("缺少必要占位符：<AGENT_ID>");
    await expect(save).toBeDisabled();

    // chip 插入光标处（fill 后光标在尾），焦点保持 textarea
    await im.locator(".chip", { hasText: "<AGENT_ID>" }).click();
    await expect(ta).toHaveValue("我的分类规则，但删掉了占位符<AGENT_ID>");
    await expect(ta).toBeFocused();
    await expect(im.locator(".validation .v-item.v-block")).toHaveCount(0);
    await expect(im.locator(".chip")).not.toHaveClass(/missing/);
    await expect(save).toBeEnabled();

    await save.click();
    await expect(im.locator(".badge.b-custom")).toContainText("自定义");
  });

  test("超过长度上限被阻断：计数器着警色、校验红字、保存禁用", async ({ page }) => {
    await openPrompts(page);
    const pet = await expandPanel(page, PET_PANEL);
    const ta = await startEdit(pet);
    const base = await ta.inputValue();
    await ta.fill(`${base}\n${"长".repeat(20000)}`);

    await expect(pet.locator(".counter")).toHaveClass(/hot/);
    await expect(pet.locator(".counter")).toContainText("/ 20000");
    await expect(pet.locator(".validation .v-item.v-block")).toContainText("超过长度上限");
    await expect(pet.locator(".validation .v-item.v-block")).toContainText("20000");
    await expect(pet.locator(".act-row .btn", { hasText: "保存" })).toBeDisabled();
  });
});

test.describe("设置 · AI 提示词 · 空白保存与恢复默认", () => {
  test("保存空白等同恢复默认：中性预告后徽章回内置默认", async ({ page }) => {
    await openPrompts(page, { ai_prompt_capture: "我的捕捉规则 <AGENT_ID>（E2E seed）" });
    const cap = await expandPanel(page, CAPTURE_PANEL);
    await expect(cap.locator(".badge.b-custom")).toContainText("自定义");

    const ta = await startEdit(cap);
    await ta.fill("");
    await expect(cap.locator(".validation .v-item.v-info")).toContainText("内容为空");
    await cap.locator(".act-row .btn", { hasText: "保存" }).click();

    await expect(cap.locator(".badge.b-default")).toContainText("内置默认");
    await expect(cap.locator(".ok-line")).toContainText("已保存");
    await expect.poll(() => readSpec(page, "capture").then((s: any) => s?.overrideText)).toBe(null);
  });

  test("恢复默认两步行内确认：清掉覆盖、徽章回内置默认", async ({ page }) => {
    await openPrompts(page, { ai_prompt_tag_health: "我的标签治理规则（E2E seed）" });
    const tag = await expandPanel(page, TAG_PANEL);
    await expect(tag.locator(".badge.b-custom")).toContainText("自定义");

    await tag.locator(".act-row .btn", { hasText: "恢复默认" }).click();
    const bar = tag.locator(".confirm-bar");
    await expect(bar).toHaveAttribute("role", "group");
    await expect(bar).toHaveAttribute("aria-label", "恢复默认确认");
    await expect(bar).toContainText("将清除自定义内容");
    await expect(page.locator("[role='dialog']")).toHaveCount(0);
    await bar.locator(".btn", { hasText: "确认恢复" }).click();

    await expect(tag.locator(".badge.b-default")).toContainText("内置默认");
    await expect(tag.locator(".ok-line")).toContainText("已恢复内置默认");
    await expect(tag.locator(".act-row .btn", { hasText: "恢复默认" })).toHaveCount(0);
    await expect.poll(() => readSpec(page, "tag_health").then((s: any) => s?.overrideText)).toBe(null);
  });
});

test.describe("设置 · AI 提示词 · 警示态", () => {
  test("default_warned 警示态：警示行列缺失占位符，编辑回填原文后修复", async ({ page }) => {
    await openPrompts(page, { ai_prompt_im_classify: "我的分类规则（E2E seed，缺占位符）" });
    const im = await expandPanel(page, IM_PANEL);
    await expect(im.locator(".badge.b-default")).toContainText("内置默认");
    await expect(im.locator(".badge.b-warn")).toContainText("不可用");
    const warn = im.locator(".warn-line");
    await expect(warn).toContainText("<AGENT_ID>");
    await expect(warn).toContainText("按内置默认生效");
    // 查看屏 = 生效文本（回落默认），覆盖原文只在编辑态回填可见；
    // 坏覆盖的恢复入口存在（SDD「坏覆盖时的查看与恢复入口」）
    await expect(im.locator(".lcd.view-lcd")).toContainText("收音机分诊助手");
    await expect(im.locator(".act-row .btn", { hasText: "恢复默认" })).toBeVisible();

    const ta = await startEdit(im);
    await expect(ta).toHaveValue("我的分类规则（E2E seed，缺占位符）");
    await im.locator(".chip", { hasText: "<AGENT_ID>" }).click();
    await im.locator(".act-row .btn", { hasText: "保存" }).click();

    await expect(im.locator(".badge.b-custom")).toContainText("自定义");
    await expect(im.locator(".warn-line")).toHaveCount(0);
    await expect(im.locator(".badge.b-warn")).toHaveCount(0);
    await expect(im.locator(".lcd.view-lcd")).toContainText("我的分类规则");
  });
});

test.describe("设置 · AI 提示词 · 读取失败", () => {
  test("读取失败呈现错误行与重试，重试后面板正常呈现", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    // 首次 list_ai_prompt_specs 拒绝（模拟读取故障）；其余命令透传原 mock
    await failFirstListSpecs(page);
    await page.locator(".menu-btn", { hasText: "背包" }).click();
    await page.locator(".stab", { hasText: "Agent" }).click();

    const err = card(page).locator(".load-error");
    await expect(err).toContainText("提示词读取失败");
    await expect(card(page).locator(".panel")).toHaveCount(0);
    await err.locator(".btn", { hasText: "重试" }).click();
    await expect(card(page).locator(".panel")).toHaveCount(5);
  });
});

test.describe("设置 · AI 提示词 · 焦点管理（UIUX §4.1）", () => {
  test("模式与状态转换的焦点管理（UIUX §4.1）", async ({ page }) => {
    await openPrompts(page, { ai_prompt_tag_health: "我的标签治理规则（E2E seed）" });
    const pet = await expandPanel(page, PET_PANEL);
    const tag = await expandPanel(page, TAG_PANEL);

    // 进编辑：焦点入 textarea 且光标置文本尾
    const ta = await startEdit(pet);
    await expect(ta).toBeFocused();
    const tail = await ta.evaluate((el) => el.value.length);
    await expect.poll(() => ta.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([tail, tail]);

    // 取消编辑：焦点回「编辑」
    await pet.locator(".act-row .btn", { hasText: "取消" }).click();
    await expect(pet.locator(".act-row .btn", { hasText: "编辑" })).toBeFocused();

    // 恢复默认确认条：焦点入主动作「确认恢复」；取消收起回「恢复默认…」
    const restore = tag.locator(".act-row .btn", { hasText: "恢复默认" });
    await restore.click();
    await expect(tag.locator(".confirm-bar .btn", { hasText: "确认恢复" })).toBeFocused();
    await tag.locator(".confirm-bar .btn", { hasText: "取消" }).click();
    await expect(restore).toBeFocused();
  });
});
