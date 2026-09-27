import { expect, test, type Locator, type Page } from "@playwright/test";
import { chatFilter, installTauriMock } from "./tauri-mock";

/**
 * 设置 · 飞书 → 会话过滤卡：渲染 / 三段切换（乐观 + mock set 返回合并视图）/ 搜索筛选 / 布局无横向滚动。
 * 后端状态断言直接经 mock 的 invoke 读回（合并规则镜像 Rust filter_decision，见 tauri-mock.ts）。
 */

const CHATS = [
  chatFilter({ chatId: "oc_team", chatName: "团队群", lastMessageAt: Date.now() - 3600_000 }),
  chatFilter({
    chatId: "oc_noisy",
    chatName: "灌水群",
    preference: "always_filter",
    effective: "filter",
    source: "manual",
    lastMessageAt: Date.now() - 2 * 86400_000,
  }),
  chatFilter({
    chatId: "oc_bot",
    chatName: "告警机器人",
    chatType: "bot",
    muteOutcome: "unknown",
    source: "followDegraded",
  }),
];

async function openFilterCard(page: Page, expectedRows = 3): Promise<Locator> {
  await page.goto("/");
  await page.locator(".menu-btn", { hasText: "背包" }).click();
  await page.locator(".stab", { hasText: "飞书" }).click();
  const card = page.locator(".cf-card");
  await expect(card.locator(".cf-row")).toHaveCount(expectedRows);
  return card;
}

function mockInvoke(page: Page, cmd: string, args: Record<string, unknown> = {}) {
  return page.evaluate(([c, a]) => (window as any).__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
}

/** DexSelect 下拉选择：展开后点第 index 项（index 含 0 = 全部档） */
async function pickSel(card: Locator, sel: string, index: number) {
  await card.locator(`${sel} .ds-btn`).click();
  await card.locator(`${sel} .ds-list li`).nth(index).click();
}

test.describe("设置 · 飞书：会话过滤卡", () => {
  test("飞书卡下方渲染会话过滤卡：手动置顶排序、摘要计数、降级标示", async ({ page }) => {
    await installTauriMock(page, { settings: { feishu_enabled: "true" }, chatFilter: CHATS });
    const card = await openFilterCard(page);

    // 位于飞书配置卡正下方（同一 stab 内，飞书卡在前；会话过滤卡本身也是一张 set-card）
    const cards = page.locator(".set-card");
    const feishuIdx = await cards.evaluateAll((els) => els.findIndex((e) => e.textContent?.includes("启用后台轮询")));
    const filterIdx = await cards.evaluateAll((els) => els.findIndex((e) => e.classList.contains("cf-card")));
    expect(feishuIdx).toBeGreaterThanOrEqual(0);
    expect(filterIdx).toBe(feishuIdx + 1);

    // 排序：手动置顶（灌水群）→ 跟随行按最近活跃倒序（团队群 1h 前）→ 从未拉到消息沉底（bot）
    await expect(card.locator(".cf-name")).toHaveText(["灌水群", "团队群", "告警机器人"]);
    // 摘要计数 + 新鲜时间戳
    await expect(card.locator(".cf-counts")).toContainText("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
    await expect(card.locator(".cf-snaptime")).toContainText("以上一轮拉取为准");
    // 降级行：warn chip + sr-only 说明经同行三段 aria-describedby 键盘可达
    const degraded = card.locator(".cf-row", { hasText: "告警机器人" });
    await expect(degraded.locator(".cf-eff.degraded")).toContainText("降级");
    await expect(degraded.locator(".sr-only")).toHaveText(/免打扰查询失败/);
    await expect(degraded.locator(".cf-seg")).toHaveAttribute("aria-describedby", "cf-dg-oc_bot");
  });

  test("三段切换：乐观切换 → mock set 返回合并行视图 → chip/计数即时校正并落库", async ({ page }) => {
    await installTauriMock(page, { settings: { feishu_enabled: "true" }, chatFilter: CHATS });
    const card = await openFilterCard(page);

    const row = card.locator(".cf-row", { hasText: "团队群" });
    const seg = row.locator(".cf-seg");
    await expect(seg).toHaveAttribute("aria-label", "团队群：过滤偏好");
    // roving tabindex：仅选中段是 Tab 停点
    const btns = seg.locator("button");
    await expect(btns.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(btns.nth(0)).toHaveAttribute("tabindex", "0");
    await expect(btns.nth(1)).toHaveAttribute("tabindex", "-1");

    // 点击「拉取」→ 即时切换 + 落库（effective=pull / source=manual 由后端合并返回）
    await btns.nth(1).click();
    await expect(btns.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(row.locator(".cf-eff.pull")).toContainText("手动");
    // 跟随(未免打扰)→总是拉取：生效状态仍为拉取，手动计数 +1
    await expect(card.locator(".cf-counts")).toContainText("共 3 个会话：2 拉取 · 1 过滤 · 手动 2");

    await expect
      .poll(async () => ((await mockInvoke(page, "get_feishu_chat_filter_overview")) as any).chats)
      .toContainEqual(
        expect.objectContaining({ chatId: "oc_team", preference: "always_pull", effective: "pull", source: "manual" }),
      );

    // 键盘处方：Tab 单停点落在选中段，ArrowLeft 即选即写（与点击同一路径）
    await btns.nth(1).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(btns.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => ((await mockInvoke(page, "get_feishu_chat_filter_overview")) as any).chats)
      .toContainEqual(
        expect.objectContaining({ chatId: "oc_team", preference: "follow", effective: "pull", source: "follow" }),
      );
  });

  test("状态筛选下拉（生效/偏好）与搜索本地过滤即时生效，摘要保持全量统计", async ({ page }) => {
    await installTauriMock(page, { settings: { feishu_enabled: "true" }, chatFilter: CHATS });
    const card = await openFilterCard(page);

    // 生效状态下拉：全部 / 拉取 / 被过滤（展开断言选项与计数）
    const effBtn = card.locator(".cf-sel-eff .ds-btn");
    await effBtn.click();
    await expect(card.locator(".cf-sel-eff .ds-list li")).toHaveText(
      ["全部 3", "拉取 2", "被过滤 1"].map((t) => `▶${t}`),
    );
    await card.locator(".cf-sel-eff .ds-list li").nth(2).click(); // 被过滤：只余灌水群
    await expect(effBtn).toContainText("被过滤 1");
    await expect(card.locator(".cf-name")).toHaveText(["灌水群"]);
    // 摘要计数不被筛选改写
    await expect(card.locator(".cf-counts")).toContainText("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");

    // 偏好设置下拉（与生效正交）：全部偏好 / 跟随 / 手动设置
    const prefBtn = card.locator(".cf-sel-pref .ds-btn");
    await prefBtn.click();
    await expect(card.locator(".cf-sel-pref .ds-list li")).toHaveText(
      ["全部偏好 3", "跟随 2", "手动设置 1"].map((t) => `▶${t}`),
    );
    await card.locator(".cf-sel-pref .ds-list li").nth(1).click(); // 被过滤 ∩ 跟随 → 交集空（灌水群是手动）
    await expect(card.locator(".cf-statebox")).toContainText("当前筛选组合下没有会话");
    await pickSel(card, ".cf-sel-pref", 2); // 被过滤 ∩ 手动设置 → 灌水群
    await expect(card.locator(".cf-name")).toHaveText(["灌水群"]);

    // 搜索叠加：手动设置 ∩ 名称
    await card.locator(".cf-search").fill("团队");
    await expect(card.locator(".cf-statebox")).toContainText("没有匹配「团队」的会话");
    // 清空搜索 + 两下拉切回全部：列表恢复
    await card.locator(".cf-search").fill("");
    await pickSel(card, ".cf-sel-eff", 0);
    await pickSel(card, ".cf-sel-pref", 0);
    await expect(card.locator(".cf-row")).toHaveCount(3);
  });

  test("类型筛选下拉：按会话类型过滤，0 计数档禁用，与偏好档正交组合、交集空走组合空态", async ({ page }) => {
    await installTauriMock(page, { settings: { feishu_enabled: "true" }, chatFilter: CHATS });
    const card = await openFilterCard(page);

    const typeBtn = card.locator(".cf-sel-type .ds-btn");
    await typeBtn.click();
    const tItems = card.locator(".cf-sel-type .ds-list li");
    await expect(tItems).toHaveText(["全部类型 3", "群聊 2", "私聊 0", "机器人 1"].map((t) => `▶${t}`));
    await expect(tItems.nth(2)).toHaveClass(/disabled/); // 种子无私聊 → 0 计数禁用

    // 群聊档：只余两个群（手动置顶的灌水群在前）
    await tItems.nth(1).click();
    await expect(typeBtn).toContainText("群聊 2");
    await expect(card.locator(".cf-name")).toHaveText(["灌水群", "团队群"]);

    // 机器人 ∩ 手动设置：交集为空 → 组合筛选空态（非搜索空态）
    await pickSel(card, ".cf-sel-type", 3);
    await pickSel(card, ".cf-sel-pref", 2);
    await expect(card.locator(".cf-statebox")).toContainText("当前筛选组合下没有会话");

    // 回全部类型：手动设置档只剩灌水群；再回全部档恢复
    await pickSel(card, ".cf-sel-type", 0);
    await expect(card.locator(".cf-name")).toHaveText(["灌水群"]);
    await pickSel(card, ".cf-sel-pref", 0);
    await expect(card.locator(".cf-row")).toHaveCount(3);
  });

  test("任何宽度不出现横向滚动（480px 窄窗行内折行）", async ({ page }) => {
    await installTauriMock(page, {
      settings: { feishu_enabled: "true" },
      chatFilter: [
        ...CHATS,
        chatFilter({ chatId: "oc_long", chatName: "产品评审会·冲刺 42 期专项长期群（跨部门联席说明与验收）" }),
      ],
    });
    await page.setViewportSize({ width: 480, height: 900 });
    const card = await openFilterCard(page, 4);

    for (const scope of [page.locator("html"), card]) {
      const noOverflow = await scope.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(noOverflow, `scrollWidth 应不超出 clientWidth`).toBe(true);
    }
    await expect(card.locator(".cf-name").first()).toHaveCSS("text-overflow", "ellipsis");
  });

  test("陈旧横幅：快照龄超阈值（max(5min, 2.5×interval)）时升级为 warn 提示", async ({ page }) => {
    // 默认 2 分钟档阈值 = 5 分钟；快照拨回 30 分钟前必触发
    await installTauriMock(page, {
      settings: { feishu_enabled: "true" },
      chatFilter: CHATS,
      chatFilterSnapshotAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const card = await openFilterCard(page);
    await expect(card.locator(".cf-stale-banner")).toContainText("距上一轮拉取已");
  });
});
