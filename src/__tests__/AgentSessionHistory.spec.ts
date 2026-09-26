import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AgentSessionHistory from "../components/AgentSessionHistory.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import type { AgentSession, SessionPage } from "../types";

/**
 * 全局会话历史卡：收音机（classify/capture）与派发（dispatch_*）共用 agent_sessions。
 * 分组过滤与 LIMIT/OFFSET 分页已下沉后端（list_agent_sessions_paged），这里用镜像
 * Rust 语义的假后端覆盖：分组过滤与切组重置页码、翻页与边界禁用、四档计数 chip、
 * SSH/local 标注、回放走 open_recorded_session（含 tmux 行）。
 */
vi.mock("../api", () => ({
  api: {
    listAgentSessionsPaged: vi.fn(),
    openRecordedSession: vi.fn(async () => "已在 Terminal 中启动"),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

function row(partial: Partial<AgentSession>): AgentSession {
  return {
    id: 1,
    agentId: "ag",
    agentName: "容器CC",
    status: "ok",
    createdAt: "2026-09-26T06:25:08Z",
    ...partial,
  };
}

/** 22 条：20 条收音机（id 22..3 倒序在前）+ 无头派发（id 2）+ 早期记录（id 1，kind 空） */
const SESSIONS: AgentSession[] = [
  ...Array.from({ length: 20 }, (_, i) =>
    row({ id: 22 - i, kind: i % 2 ? "classify" : "capture", sessionId: `s${22 - i}` }),
  ),
  row({
    id: 2,
    kind: "dispatch_headless",
    taskId: 9,
    costUsd: 0.3,
    durationMs: 61_000,
    remoteHost: "vscode@localhost",
  }),
  row({ id: 1, kind: "", sessionId: null, command: "claude ..." }),
];

const RADIO = new Set(["classify", "capture"]);
const DISPATCH = new Set(["dispatch_headless", "dispatch_interactive"]);

/** 假后端：分组过滤 + LIMIT/OFFSET 切片（与 Rust session_group_sql + 分页语义一致） */
function fakePage(group: string, limit: number, offset: number): SessionPage {
  const rows = SESSIONS.filter((x) => {
    const k = x.kind ?? "";
    if (group === "radio") return RADIO.has(k);
    if (group === "dispatch") return DISPATCH.has(k);
    if (group === "other") return !RADIO.has(k) && !DISPATCH.has(k);
    return true;
  });
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    counts: {
      all: SESSIONS.length,
      radio: SESSIONS.filter((x) => RADIO.has(x.kind ?? "")).length,
      dispatch: SESSIONS.filter((x) => DISPATCH.has(x.kind ?? "")).length,
      other: SESSIONS.filter((x) => !RADIO.has(x.kind ?? "") && !DISPATCH.has(x.kind ?? "")).length,
    },
  };
}

async function mounted() {
  const w = mount(AgentSessionHistory, { global: { plugins: [i18n] } });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia()); // fmtDateTime 默认参数经 useSettingsStore 格式化时间
  vi.mocked(api.listAgentSessionsPaged).mockImplementation(async (g, l, o) => fakePage(g, l, o));
  vi.mocked(api.openRecordedSession).mockClear();
});

describe("AgentSessionHistory", () => {
  it("分页拉取：首页 20 行、第 2 页收尾、边界按钮禁用", async () => {
    const w = await mounted();
    expect(api.listAgentSessionsPaged).toHaveBeenCalledWith("all", 20, 0);
    expect(w.findAll(".sess-row")).toHaveLength(20);
    expect(w.get(".sess-pageinfo").text()).toBe("第 1/2 页");
    expect(w.findAll(".sess-pager .btn")[0].attributes("disabled")).toBeDefined();
    expect(w.findAll(".sess-pager .btn")[1].attributes("disabled")).toBeUndefined();

    await w.findAll(".sess-pager .btn")[1].trigger("click"); // 下一页
    expect(api.listAgentSessionsPaged).toHaveBeenCalledWith("all", 20, 20);
    expect(w.findAll(".sess-row")).toHaveLength(2);
    expect(w.get(".sess-pageinfo").text()).toBe("第 2/2 页");
    expect(w.findAll(".sess-pager .btn")[1].attributes("disabled")).toBeDefined();
    expect(w.findAll(".sess-pager .btn")[0].attributes("disabled")).toBeUndefined();
  });

  it("分组过滤下沉后端且切组重置页码；计数 chip 展示四档全量", async () => {
    const w = await mounted();
    // 四档计数不随分组/翻页变化
    const chips = w.findAll(".chip");
    expect(chips[0].text()).toContain("22"); // 全部
    expect(chips[1].text()).toContain("20"); // 收音机
    expect(chips[2].text()).toContain("1"); // 派发
    expect(chips[3].text()).toContain("1"); // 其他

    await chips[2].trigger("click"); // 派发：无头派发行带 SSH 标注
    expect(api.listAgentSessionsPaged).toHaveBeenLastCalledWith("dispatch", 20, 0);
    expect(w.findAll(".sess-row")).toHaveLength(1);
    expect(w.get(".sess-host").text()).toContain("vscode@localhost");

    await chips[3].trigger("click"); // 其他：早期记录（kind 空）
    expect(api.listAgentSessionsPaged).toHaveBeenLastCalledWith("other", 20, 0);
    expect(w.findAll(".sess-row")).toHaveLength(1);
    expect(w.text()).toContain("早期记录");

    await chips[1].trigger("click"); // 收音机：单页放得下，翻页条隐藏
    expect(api.listAgentSessionsPaged).toHaveBeenLastCalledWith("radio", 20, 0);
    expect(w.findAll(".sess-row")).toHaveLength(20);
    expect(w.find(".sess-pager").exists()).toBe(false);
  });

  it("回放按钮走 open_recorded_session（含 tmux 行）", async () => {
    const w = await mounted();
    await w.get(".sess-row:nth-child(1) .sess-open").trigger("click");
    expect(api.openRecordedSession).toHaveBeenCalledWith(22);
    expect(w.text()).toContain("已在 Terminal 中启动");
  });

  it("空分组显示空态", async () => {
    vi.mocked(api.listAgentSessionsPaged).mockResolvedValue({
      items: [],
      total: 0,
      counts: { all: 0, radio: 0, dispatch: 0, other: 0 },
    });
    const w = await mounted();
    expect(w.find(".sess-empty").exists()).toBe(true);
  });
});
