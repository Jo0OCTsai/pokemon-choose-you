/**
 * 复盘向导测试公共件：PanelData / mockHost 夹具 + 渲染壳 + 步进导航
 * （review-wizard.spec 与 review-wizard-tags.spec 共用；对照桌面 ReviewWizard.vue 行为）。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { ReviewWizard } from "../../src/client/tasks/ReviewWizard";
import { makeCategory, makeData, makeTask } from "./fixtures";
import type { PanelData } from "../../src/client/model";
import type { TagCheckupReport } from "../../src/client/rpcTypes";
import type { Tag, TagDimension } from "../../src/host/domain/vocabulary-tags";

/** 刷完 mock 异步链 */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export const isoDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

/** 本地今天 YYYY-MM-DD（收尾落库口径） */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORIES = [makeCategory({ id: 1, name: "工作" }), makeCategory({ id: 2, name: "生活" })];

export function wizardTasks(): PanelData["tasks"] {
  return [
    // 本周完成 ×2（一个完整 ISO、一个 16 位无秒形态），专注合计 2400s = 40 分
    makeTask({ id: 1, status: "done", completedAt: isoDaysAgo(1), focusSeconds: 1800, categoryId: 1 }),
    makeTask({ id: 2, status: "done", completedAt: isoDaysAgo(2).slice(0, 16), focusSeconds: 600, categoryId: 2 }),
    // 路线 ×2：逾期 scheduled（带备注）+ 进行中
    makeTask({
      id: 3,
      status: "scheduled",
      dueAt: isoDaysAgo(1),
      note: "路线备注",
      priority: "high",
      categoryId: 1,
      title: "逾期路线任务",
    }),
    makeTask({ id: 7, status: "active", startedAt: isoDaysAgo(0), categoryId: 1, title: "进行中任务" }),
    // 草丛 ×2 + 已逃走
    makeTask({ id: 4, status: "inbox", title: "草丛甲" }),
    makeTask({ id: 5, status: "inbox", title: "草丛乙" }),
    makeTask({ id: 6, status: "cancelled", cancelledAt: isoDaysAgo(3) }),
  ];
}

/** mock 词表夹具：体检报告引用的 11/12/13（合并对 + 僵尸）+ 「采纳」待迁的 21/22（topic 维度） */
const FIXTURE_TAGS: Tag[] = [
  {
    id: 11,
    name: "周报",
    description: "",
    dimension: "topic",
    origin: "manual",
    meta: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    usage: 1,
  },
  {
    id: 12,
    name: "工作周报",
    description: "",
    dimension: "topic",
    origin: "manual",
    meta: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    usage: 2,
  },
  {
    id: 13,
    name: "幻觉标签",
    description: "",
    dimension: "topic",
    origin: "ai",
    meta: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    usage: 0,
  },
  {
    id: 21,
    name: "深度工作",
    description: "",
    dimension: "topic",
    origin: "manual",
    meta: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    usage: 0,
  },
  {
    id: 22,
    name: "碎片处理",
    description: "",
    dimension: "topic",
    origin: "manual",
    meta: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    usage: 0,
  },
];

const FIXTURE_DIMENSIONS: TagDimension[] = [
  { id: 4, key: "topic", name: "主题", cardinality: "multi", maxTags: 30, sort: 4, enabled: true },
];

export const FIXTURE_CHECKUP: TagCheckupReport = {
  merges: [
    {
      fromId: 11,
      fromName: "周报",
      intoId: 12,
      intoName: "工作周报",
      dimension: "topic",
      similarity: 0.9,
      judged: false,
      reason: null,
    },
  ],
  zombies: [{ id: 13, name: "幻觉标签", dimension: "topic", origin: "ai", createdAt: "2026-01-01T00:00:00+00:00" }],
  newDimensions: [{ name: "Energy", tags: ["深度工作", "碎片处理"], reason: null }],
  judged: false,
};

export function wizardData(): PanelData {
  return makeData({
    tasks: wizardTasks(),
    categories: CATEGORIES,
    tags: FIXTURE_TAGS,
    dimensions: FIXTURE_DIMENSIONS,
  });
}

export function wizardHost(): MockHost {
  // mock 命令组在 state 上真实移改（taskUpdate 就地改 / tagMerge 删行 / tagMove 迁维度）——
  // 夹具逐实例拷贝防跨用例泄漏；tasks 与 PanelData 各持一份（组件读 props、mock 读 state）
  return mockHost({
    tasks: wizardTasks(),
    tags: FIXTURE_TAGS.map((t) => ({ ...t })),
    dimensions: FIXTURE_DIMENSIONS.map((d) => ({ ...d })),
    tagCheckup: FIXTURE_CHECKUP,
  });
}

export function renderWizard(
  data: PanelData = wizardData(),
  host: MockHost = wizardHost(),
): { host: MockHost; onChanged: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <ReviewWizard data={data} onClose={onClose} onChanged={onChanged} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onChanged, onClose };
}

/** 点主按钮（下一步/跳过路线共用槽位）从当前步推进到指定步 */
export async function goStep(target: number): Promise<void> {
  let current = Number(screen.getByTestId("review-wizard").getAttribute("data-step"));
  while (current < target) {
    const button = ["下一步", "跳过路线"].map((label) => screen.queryByText(label)).find((b) => b !== null);
    expect(button, `第 ${current} 步应有主按钮`).toBeTruthy();
    fireEvent.click(button as HTMLElement);
    await flush();
    const next = Number(screen.getByTestId("review-wizard").getAttribute("data-step"));
    expect(next).toBe(current + 1);
    current = next;
  }
}
