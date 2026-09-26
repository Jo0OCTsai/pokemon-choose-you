import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AgentSessionHistory from "../components/AgentSessionHistory.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import type { AgentSession } from "../types";

/**
 * 全局会话历史卡：收音机（classify/capture）与派发（dispatch_*）共用 agent_sessions，
 * task_id 为空的收音机会话此前无 UI 入口。这里覆盖：来源筛选、SSH/local 标注、
 * 回放走 open_recorded_session（含 tmux 行）。
 */
vi.mock("../api", () => ({
  api: {
    listAgentSessions: vi.fn(async () => [] as AgentSession[]),
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

const SESSIONS: AgentSession[] = [
  row({
    id: 6,
    kind: "capture",
    sessionId: "0b0ae984",
    remoteHost: "vscode@localhost",
    workdir: "/home/vscode/.choose-you/workspace",
  }),
  row({ id: 5, kind: "classify", sessionId: "5e09f72c", status: "error" }),
  row({ id: 4, kind: "dispatch_headless", taskId: 9, sessionId: "aabb", costUsd: 0.3, durationMs: 61_000 }),
  row({ id: 3, kind: "dispatch_interactive", tmuxSession: "pk-3", remoteHost: "vscode@localhost" }),
  row({ id: 2, kind: "", sessionId: null, command: "claude ..." }),
];

async function mounted() {
  const w = mount(AgentSessionHistory, { global: { plugins: [i18n] } });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia()); // fmtDateTime 默认参数经 useSettingsStore 格式化时间
  vi.mocked(api.listAgentSessions).mockResolvedValue(SESSIONS);
  vi.mocked(api.openRecordedSession).mockClear();
});

describe("AgentSessionHistory", () => {
  it("列出全部会话并标注来源与执行机器；筛选档按来源过滤", async () => {
    const w = await mounted();
    expect(w.findAll(".sess-row")).toHaveLength(5);
    // 远程行带 SSH 标注，本地行标 local；早期记录（kind 空）显示「早期记录」
    expect(w.get(".sess-row:nth-child(1) .sess-host").text()).toContain("vscode@localhost");
    expect(w.get(".sess-row:nth-child(3) .sess-host").text()).toBe("local");
    expect(w.text()).toContain("早期记录");
    expect(w.text()).toContain("快速捕捉");
    expect(w.text()).toContain("收音机分类");

    await w.findAll(".chip")[1].trigger("click"); // 收音机：classify + capture
    expect(w.findAll(".sess-row")).toHaveLength(2);
    await w.findAll(".chip")[2].trigger("click"); // 派发：headless + interactive
    expect(w.findAll(".sess-row")).toHaveLength(2);
    await w.findAll(".chip")[3].trigger("click"); // 其他：早期记录
    expect(w.findAll(".sess-row")).toHaveLength(1);
    await w.findAll(".chip")[0].trigger("click"); // 全部
    expect(w.findAll(".sess-row")).toHaveLength(5);
  });

  it("回放按钮走 open_recorded_session（含 tmux 行）", async () => {
    const w = await mounted();
    await w.get(".sess-row:nth-child(1) .sess-open").trigger("click");
    expect(api.openRecordedSession).toHaveBeenCalledWith(6);
    // tmux 行（远程交互派发）也可回放：重连 tmux
    await w.get(".sess-row:nth-child(4) .sess-open").trigger("click");
    expect(api.openRecordedSession).toHaveBeenCalledWith(3);
    expect(w.text()).toContain("已在 Terminal 中启动");
  });

  it("空列表显示空态", async () => {
    vi.mocked(api.listAgentSessions).mockResolvedValue([]);
    const w = await mounted();
    expect(w.find(".sess-empty").exists()).toBe(true);
  });
});
