import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TagDispatchCard from "../components/TagDispatchCard.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useTagsStore } from "../stores/tags";
import type { AgentConfig, Tag } from "../types";

vi.mock("../api", () => ({
  api: {
    setTagMeta: vi.fn(async () => {}),
    // saveMeta 保存后 tagsStore.load() 会拉取
    listTags: vi.fn(async () => []),
    listTagDimensions: vi.fn(async () => []),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

const AGENTS: AgentConfig[] = [
  {
    id: "ag-local",
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "",
    timeoutSecs: 120,
    enabled: true,
    remote: null,
  },
  {
    id: "ag-remote",
    name: "Claude Code 2",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "",
    timeoutSecs: 120,
    enabled: true,
    remote: { host: "me@server", port: 22, keyPath: "" },
  },
  {
    id: "ag-off",
    name: "Kiro CLI",
    command: "kiro-cli",
    args: "chat",
    historyArgs: "",
    timeoutSecs: 120,
    enabled: false,
    remote: null,
  },
];

function tag(partial: Partial<Tag> & { id: number }): Tag {
  return {
    name: `标签${partial.id}`,
    description: "",
    dimension: "project",
    origin: "manual",
    usage: 0,
    createdAt: "2026-09-01T00:00:00Z",
    meta: null,
    ...partial,
  };
}

async function mountCard(seed: Tag[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const tags = useTagsStore();
  tags.list = seed;
  const w = mount(TagDispatchCard, {
    props: { agents: AGENTS },
    global: { plugins: [pinia, i18n] },
  });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

describe("TagDispatchCard 项目派发卡片", () => {
  it("只渲染 project 维度的标签，一标签一节，带配置状态徽标", async () => {
    const w = await mountCard([
      tag({ id: 1, meta: { agentId: "ag-local" } }),
      tag({ id: 2, name: "未配置项目" }),
      tag({ id: 3, dimension: "topic", name: "主题标签" }),
    ]);
    const blocks = w.findAll(".dispatch-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text()).toContain("标签1");
    expect(blocks[0].get(".db-state.on").text()).toContain("已配置");
    expect(blocks[1].get(".db-state:not(.on)").text()).toContain("未配置");
  });

  it("meta 预填草稿，agent 下拉显示已选 agent（含 SSH 徽标）", async () => {
    const w = await mountCard([tag({ id: 1, meta: { workdir: "~/repo", agentId: "ag-remote", context: "Rust" } })]);
    expect((w.get("input").element as HTMLInputElement).value).toBe("~/repo");
    await w.get(".ds-btn").trigger("click");
    // 不指定 + 3 个 agent（含已停用的 ag-off 只在未保存时不出现 → 这里 4 项里应有 SSH 项，无已停用项）
    const items = w.findAll(".ds-list li");
    expect(items.map((i) => i.text())).toEqual([
      expect.stringContaining("不指定"),
      expect.stringContaining("Claude Code"),
      expect.stringContaining("Claude Code 2 · SSH"),
    ]);
  });

  it("已保存但停用的 agent 保留在下拉里，避免退化成裸 id", async () => {
    const w = await mountCard([tag({ id: 1, meta: { agentId: "ag-off" } })]);
    await w.get(".ds-btn").trigger("click");
    const items = w.findAll(".ds-list li");
    expect(items).toHaveLength(4);
    expect(items[3].text()).toContain("已停用");
  });

  it("保存把空串归一成 null 落库，成功后发出 feedback", async () => {
    const w = await mountCard([tag({ id: 7, name: "周报", meta: { workdir: "~/repo" } })]);
    const inputs = w.findAll("input");
    await inputs[1].setValue("Rust 项目"); // 项目上下文
    await w.get(".btn-row .btn").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.setTagMeta).toHaveBeenCalledWith(7, { workdir: "~/repo", agentId: null, context: "Rust 项目" });
    expect(w.emitted("feedback")?.[0]?.[0]).toContain("标签已更新");
  });

  it("保存失败时 feedback 带错误信息", async () => {
    vi.mocked(api.setTagMeta).mockRejectedValueOnce(new Error("boom"));
    const w = await mountCard([tag({ id: 7 })]);
    await w.get(".btn-row .btn").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("feedback")?.[0]?.[0]).toContain("boom");
  });

  it("没有 project 标签时显示空态指引", async () => {
    const w = await mountCard([tag({ id: 1, dimension: "topic" })]);
    expect(w.find(".dispatch-block").exists()).toBe(false);
    expect(w.get(".hint").text()).toContain("项目");
  });
});
