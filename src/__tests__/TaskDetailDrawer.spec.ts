import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useCategoriesStore } from "../stores/categories";
import type { AgentSession, Task, TaskDispatchTarget, TaskNote } from "../types";

vi.mock("../api", () => ({
  api: {
    listTaskNotes: vi.fn(async () => [] as TaskNote[]),
    addTaskNote: vi.fn(async () => {}),
    deleteTaskNote: vi.fn(async () => {}),
    listAgentSessions: vi.fn(async () => [] as AgentSession[]),
    listTaskLogs: vi.fn(async () => []),
    resolveTaskDispatch: vi.fn(async () => null),
    dispatchTask: vi.fn(async () => ({})),
    markDispatch: vi.fn(async () => {}),
    openRecordedSession: vi.fn(async () => {}),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

function task(partial: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "整理图鉴",
    note: null,
    categoryId: 1,
    status: "active",
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-13T00:00:00Z",
    completedAt: null,
    startedAt: null,
    cancelledAt: null,
    focusSeconds: 0,
    tags: [],
    dispatchState: null,
    dispatchedSession: null,
    ...partial,
  };
}

function target(partial: Partial<TaskDispatchTarget> = {}): TaskDispatchTarget {
  return {
    taskId: 1,
    hasProjectTag: true,
    projectTag: "pkm",
    source: "default",
    agentId: "ag-1",
    agentName: "Claude Code",
    sshHost: null,
    workdir: "",
    context: null,
    agents: [
      { id: "ag-1", name: "Claude Code", sshHost: null },
      { id: "ag-2", name: "OpenCode", sshHost: "me@server" },
    ],
    ...partial,
  };
}

async function mountDrawer(t: Task = task()) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useCategoriesStore().list = [{ id: 1, name: "工作", pokemon: "", sprite: "", enabled: true, description: "" }];
  const w = mount(TaskDetailDrawer, { props: { task: t }, global: { plugins: [pinia, i18n] } });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  vi.mocked(api.listTaskNotes).mockResolvedValue([]);
  vi.mocked(api.listAgentSessions).mockResolvedValue([]);
  vi.mocked(api.listTaskLogs).mockResolvedValue([]);
  // 无 project 标签用例的默认（null 在真实类型外，见 loadDispatch 的 catch 静默分支）
  vi.mocked(api.resolveTaskDispatch).mockResolvedValue(null as unknown as TaskDispatchTarget);
});

describe("TaskDetailDrawer 总览与历史", () => {
  it("渲染总览：分类名、空值占位、标签维度前缀", async () => {
    const w = await mountDrawer(
      task({
        tags: [
          { name: "pkm", dimension: "project" },
          { name: "晚间", dimension: "context" },
        ],
      }),
    );
    expect(w.text()).toContain("工作");
    expect(w.text()).toContain("⛳ pkm");
    expect(w.text()).toContain("# 晚间");
    expect(w.text()).toContain("—"); // 无截止时间显示占位
  });

  it("操作历史：字段值空显示占位，状态字段走翻译", async () => {
    vi.mocked(api.listTaskLogs).mockResolvedValue([
      {
        id: 3,
        taskId: 1,
        action: "update",
        field: "status",
        oldValue: null,
        newValue: "done",
        origin: "main",
        createdAt: "2026-09-13T00:00:00Z",
      },
    ]);
    const w = await mountDrawer();
    expect(w.text()).toContain(i18n.global.t("status.done"));
    expect(w.text()).toContain("→"); // 新旧值同行展示
  });
});

describe("TaskDetailDrawer 跟进记录", () => {
  it("提交新增、空内容跳过、失败显示错误", async () => {
    const w = await mountDrawer();
    const input = w.get("form.note-add input");
    await input.setValue("跟进一下进度");
    await w.get("form.note-add").trigger("submit");
    expect(api.addTaskNote).toHaveBeenCalledWith(1, "跟进一下进度");

    // 空内容直接提交不动 api
    await input.setValue("   ");
    await w.get("form.note-add").trigger("submit");
    expect(api.addTaskNote).toHaveBeenCalledTimes(1);

    vi.mocked(api.addTaskNote).mockRejectedValueOnce("写不进去");
    await input.setValue("再试一条");
    await w.get("form.note-add").trigger("submit");
    await new Promise((r) => setTimeout(r));
    expect(w.find("p.err").text()).toContain("写不进去");
  });

  it("删除走两段式确认：第一次变确认态，第二次才删", async () => {
    vi.mocked(api.listTaskNotes).mockResolvedValue([
      { id: 9, taskId: 1, content: "旧跟进", source: "manual", createdAt: "2026-09-13T00:00:00Z" },
    ]);
    const w = await mountDrawer();
    await w.get("button.note-del").trigger("click");
    expect(w.get("button.note-del").classes()).toContain("confirming");
    expect(api.deleteTaskNote).not.toHaveBeenCalled();
    await w.get("button.note-del").trigger("click");
    expect(api.deleteTaskNote).toHaveBeenCalledWith(9);
  });
});

describe("TaskDetailDrawer 派发解析", () => {
  it("无 project 标签时提示需要标签，且不解析派发目标", async () => {
    const w = await mountDrawer(task());
    expect(w.text()).toContain(i18n.global.t("dispatch.needTag"));
    expect(api.resolveTaskDispatch).not.toHaveBeenCalled();
  });

  it("解析目标后显示 agent 徽章与工作目录", async () => {
    vi.mocked(api.resolveTaskDispatch).mockResolvedValue(target({ agentId: "ag-2", workdir: "/srv/pkm" }));
    const w = await mountDrawer(task({ tags: [{ name: "pkm", dimension: "project" }] }));
    expect(w.text()).toContain("OpenCode");
    expect(w.text()).toContain("SSH me@server");
    expect(w.text()).toContain("/srv/pkm");
  });
});

describe("TaskDetailDrawer 派发执行", () => {
  it("交互派发成功：消息含终端名，状态徽章随回传更新", async () => {
    vi.mocked(api.resolveTaskDispatch).mockResolvedValue(target());
    vi.mocked(api.dispatchTask).mockResolvedValue({
      channel: "interactive",
      terminal: "iTerm",
      note: null,
      state: "running",
      session: {
        id: 5,
        agentId: "ag-1",
        agentName: "Claude Code",
        status: "ok",
        createdAt: "2026-09-13T00:00:00Z",
      },
    });
    const w = await mountDrawer(task({ tags: [{ name: "pkm", dimension: "project" }] }));
    await w.get(".dsp-row .btn").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.dispatchTask).toHaveBeenCalledWith(1, "ag-1", "interactive");
    expect(w.text()).toContain("iTerm");
    expect(w.find(".dsp-state").classes()).toContain("running");
  });

  it("派发失败：错误文案展示", async () => {
    vi.mocked(api.resolveTaskDispatch).mockResolvedValue(target());
    vi.mocked(api.dispatchTask).mockRejectedValue("agent 没起来");
    const w = await mountDrawer(task({ tags: [{ name: "pkm", dimension: "project" }] }));
    await w.get(".dsp-row .btn").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.text()).toContain("agent 没起来");
  });
});

describe("TaskDetailDrawer 手动标记", () => {
  it("完成收口变 done 且救援行收起；重置后徽章消失", async () => {
    vi.mocked(api.resolveTaskDispatch).mockResolvedValue(target());
    const w = await mountDrawer(task({ tags: [{ name: "pkm", dimension: "project" }], dispatchState: "queued" }));
    expect(w.find(".dsp-state").classes()).toContain("queued");
    await w.findAll(".dsp-mark .btn")[0].trigger("click"); // 标记完成
    await new Promise((r) => setTimeout(r));
    expect(api.markDispatch).toHaveBeenCalledWith(1, "done");
    expect(w.find(".dsp-state").classes()).toContain("done");
    expect(w.find(".dsp-mark").exists()).toBe(false); // done 后救援行收起
  });

  it("重置：queued 起点标记 idle 后徽章消失", async () => {
    vi.mocked(api.resolveTaskDispatch).mockResolvedValue(target());
    const w = await mountDrawer(task({ tags: [{ name: "pkm", dimension: "project" }], dispatchState: "queued" }));
    await w.findAll(".dsp-mark .btn")[2].trigger("click"); // 重置
    await new Promise((r) => setTimeout(r));
    expect(api.markDispatch).toHaveBeenCalledWith(1, "idle");
    expect(w.find(".dsp-state").exists()).toBe(false);
  });
});

describe("TaskDetailDrawer Agent 执行区", () => {
  it("来源徽章、时长收敛、成本合计、跳转会话", async () => {
    vi.mocked(api.listAgentSessions).mockResolvedValue([
      {
        id: 5,
        agentId: "ag-1",
        agentName: "Claude Code",
        sessionId: "s-1",
        status: "ok",
        kind: "classify",
        durationMs: 90_000,
        costUsd: 0.5,
        createdAt: "2026-09-13T00:00:00Z",
      },
    ]);
    const w = await mountDrawer();
    expect(w.text()).toContain(i18n.global.t("sess.kind.classify"));
    expect(w.text()).toContain("2m"); // 90 秒收敛到分钟
    expect(w.text()).toContain("$0.50"); // 成本合计展示
    await w.get("button.run-open").trigger("click");
    expect(api.openRecordedSession).toHaveBeenCalledWith(5);
  });
});
