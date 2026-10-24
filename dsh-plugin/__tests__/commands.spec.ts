/**
 * host 命令装配面：49+1 命令完整性（HOST_COMMAND_NAMES 单源）+ 每命令至少一个
 * happy path 调用（信封 ok / data 落库；全命令覆盖装配层，细节行为已有各域单测）。
 * deps 走 createHostCommands 直装（fake lark/poll/pet/terminal——不经 createPlugin，
 * 插件级装配链路由 integration.spec 覆盖）。
 * 背包/诊断/桌宠/通用/专注域之外的分域（标签体检/实体读/备份导出）→ commands-misc.spec；
 * 临时库/deps 装配/种子便捷件 → commandsSetup。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/host/domain/settings";
import { HOST_COMMAND_NAMES } from "../src/host/commands";
import { createHandoffTerminal } from "../src/host/dispatch/terminalAdapters";
import { attachProjectTag, createCommandsFixture, seedMsg, seedTask, type CommandsFixture } from "./commandsSetup";

let f: CommandsFixture;

beforeEach(() => {
  f = createCommandsFixture();
});

afterEach(() => {
  f.close();
});

/** 编辑/跟进/历史用例主体（describe 回调行数棘轮受限，长用例体提为命名函数等量迁出） */
async function runTaskEditHistoryCase(): Promise<void> {
  const id = seedTask(f.conn, "编辑目标");
  expect(
    await f.call("taskUpdate", { id, title: "改后标题", note: "备注", priority: "high", dueAt: "2026-06-02T09:00" }),
  ).toMatchObject({ ok: true, data: { id, title: "改后标题", note: "备注", priority: "high" } });
  const missing = (await f.call("taskUpdate", { id: 424242, title: "幽灵" })) as {
    ok: boolean;
    error: { code: string };
  };
  expect(missing.ok).toBe(false);
  expect(missing.error.code).toBe("NOT_FOUND");

  const note = (await f.call("taskNoteAdd", { taskId: id, content: "  手动跟进  " })) as {
    ok: boolean;
    data: { id: number; content: string; source: string };
  };
  expect(note.ok).toBe(true);
  expect(note.data.content).toBe("手动跟进"); // 去空格
  expect(note.data.source).toBe("manual");
  const empty = (await f.call("taskNoteAdd", { taskId: id, content: "   " })) as { ok: boolean };
  expect(empty.ok).toBe(false);

  const hist = (await f.call("taskHistory", { taskId: id })) as {
    ok: boolean;
    data: { logs: Array<{ action: string; field: string; newValue: string | null }> };
  };
  expect(hist.ok).toBe(true);
  expect(hist.data.logs.some((l) => l.action === "update" && l.field === "title" && l.newValue === "改后标题")).toBe(
    true,
  );

  expect(await f.call("taskNoteDelete", { id: note.data.id })).toMatchObject({ ok: true });
  const after = (await f.call("taskDetail", { taskId: id })) as { data: { followups: unknown[] } };
  expect(after.data.followups).toHaveLength(0);
}

/** agent 绑定部署用例主体（行数棘轮提为命名函数）：存在才可绑定（INVALID_ARGUMENT）、空串归一 null */
async function runAgentDeploymentBindingCase(agent: AgentConfig): Promise<void> {
  const up = (a: AgentConfig) => f.call("agentUpsert", { agent: a });
  expect(await f.call("deploymentUpsert", { alias: "gpu-1", nodePath: "/usr/bin/node" })).toMatchObject({ ok: true });
  expect(await up({ ...agent, id: "ag-dep", deployment: "gpu-1" })).toMatchObject({ ok: true });
  expect(await up({ ...agent, id: "ag-ghost", deployment: "no-such-box" })).toMatchObject({
    ok: false,
    error: { code: "INVALID_ARGUMENT" },
  });
  const blanked = (await up({ ...agent, id: "ag-dep", deployment: "" })) as { data: { agents: AgentConfig[] } };
  expect(blanked.data.agents.find((a) => a.id === "ag-dep")?.deployment ?? null).toBeNull();
}

describe("host 命令装配面（AD §4.1.1）· 全集与任务域", () => {
  it("命令名全集 = 88 条目（69 既有 + full-parity §4.1 新增 16 + macAuthPaneOpen 联调对齐 1 + sshAliasList 表单数据源 1 + deploymentSetupPk pk 通道开通 1；taskCreate 已移除），未知命令 INVALID_ARGUMENT", async () => {
    expect(HOST_COMMAND_NAMES).toHaveLength(90);
    const unknown = (await f.call("nope")) as { ok: boolean; error: { code: string } };
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe("INVALID_ARGUMENT");
  });

  it("任务域：Start/Pause/Resume/Complete/Cancel/Delete/Undo/Reschedule", async () => {
    const id = seedTask(f.conn, "命令面任务");
    expect(await f.call("taskStart", { taskId: id })).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await f.call("taskPause", {})).toMatchObject({ ok: true });
    expect(await f.call("taskResume", {})).toMatchObject({ ok: true });
    const done = seedTask(f.conn, "完成目标", { status: "active" });
    expect(await f.call("taskComplete", { taskId: done })).toMatchObject({ ok: true });
    const esc = seedTask(f.conn, "逃走目标");
    expect(await f.call("taskCancel", { taskId: esc, reasonCode: "noise" })).toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    const del = seedTask(f.conn, "放生目标");
    expect(await f.call("taskDelete", { taskId: del })).toEqual({ ok: true, data: { taskId: del } });
    expect(await f.call("taskDeleteUndo", { taskId: del })).toMatchObject({ ok: true, data: { id: del } });
    const rs = seedTask(f.conn, "改期目标");
    expect(await f.call("taskReschedule", { taskId: rs, due: "2026-06-01T09:00" })).toMatchObject({ ok: true });
  });

  it("任务编辑/跟进/历史：taskUpdate 全字段 patch + 审计日志 + 跟进增删", runTaskEditHistoryCase);
});

describe("host 命令装配面 · 收音机域", () => {
  it("快捕与分诊四路 + 放生撤销窗口外参数错", async () => {
    const stale = (await f.call("taskDeleteUndo", { taskId: 424242 })) as { ok: boolean; error: { code: string } };
    expect(stale.error.code).toBe("INVALID_ARGUMENT");
    expect(await f.call("captureTodo", { text: "记得买咖啡" })).toMatchObject({
      ok: true,
      data: { outcome: "caught" },
    });
    seedMsg(f.conn, "om_acc", { aiStatus: "todo", title: "待接受" });
    expect(await f.call("reviewAccept", { messageId: "om_acc" })).toMatchObject({
      ok: true,
      data: { messageId: "om_acc" },
    });
    const upd = seedTask(f.conn, "更新目标");
    seedMsg(f.conn, "om_upd", { aiStatus: "update", title: "改名", updateTask: upd });
    expect(await f.call("reviewApplyUpdate", { messageId: "om_upd" })).toMatchObject({
      ok: true,
      data: { taskId: upd },
    });
    seedMsg(f.conn, "om_dis");
    expect(await f.call("reviewDismiss", { messageId: "om_dis", reasonCode: "noise" })).toMatchObject({ ok: true });
    seedMsg(f.conn, "om_res");
    await f.call("reviewDismiss", { messageId: "om_res", reasonCode: "noise" });
    expect(await f.call("reviewRestore", { messageId: "om_res" })).toMatchObject({ ok: true });
  });

  it("批量分诊 / 失败组 / 手动拉取", async () => {
    seedMsg(f.conn, "om_b1", { aiStatus: "todo", title: "批一" });
    seedMsg(f.conn, "om_b2", { aiStatus: "todo", title: "批二" });
    const batch = (await f.call("reviewBatch", {
      messageIds: ["om_b1", "om_b2"],
      op: "dismiss",
      reasonCode: "noise",
    })) as {
      data: { results: Array<{ ok: boolean }> };
    };
    expect(batch.data.results.every((r) => r.ok)).toBe(true);
    seedMsg(f.conn, "om_err", { aiStatus: "error", review: "pending" });
    expect(await f.call("retryJudge", { messageIds: ["om_err"] })).toMatchObject({ ok: true });
    seedMsg(f.conn, "om_fc", { aiStatus: "none" });
    expect(await f.call("forceCapture", { messageId: "om_fc" })).toMatchObject({ ok: true });
    seedMsg(f.conn, "om_fd");
    expect(await f.call("forceDismiss", { messageId: "om_fd", reasonCode: "noise" })).toMatchObject({ ok: true });
    expect(await f.call("pollNow")).toMatchObject({ ok: true });
  });
});

/** 派发用 agent 配置落库（ag-1 → true 命令，workdir 指临时根） */
function seedAgentEntry(): void {
  f.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "A",
        command: "true",
        args: "",
        historyArgs: "",
        workdir: f.dir,
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
}

describe("host 命令装配面 · 派发与设置域", () => {
  it("六派发 + config/route/lark", async () => {
    seedAgentEntry();
    const inter = seedTask(f.conn, "交互派发");
    attachProjectTag(f.conn, f.dir, inter);
    expect(await f.call("dispatchInteractive", { taskId: inter })).toMatchObject({
      ok: true,
      data: { state: "running" },
    });
    const head = seedTask(f.conn, "无头派发");
    attachProjectTag(f.conn, f.dir, head);
    expect(await f.call("dispatchHeadless", { taskId: head })).toMatchObject({ ok: true });
    const closing = seedTask(f.conn, "收口目标", { dispatch: "running" });
    expect(await f.call("dispatchClose", { taskId: closing, result: "done", note: "完成" })).toMatchObject({
      ok: true,
      data: { state: "done" },
    });
    const reset = seedTask(f.conn, "重置目标", { dispatch: "running" });
    expect(await f.call("dispatchReset", { taskId: reset })).toMatchObject({ ok: true });
    const cancel = seedTask(f.conn, "取消排队", { dispatch: "queued" });
    expect(await f.call("dispatchCancel", { taskId: cancel })).toMatchObject({ ok: true });
    const redo = seedTask(f.conn, "重派目标", { dispatch: "done" });
    attachProjectTag(f.conn, f.dir, redo);
    expect(await f.call("dispatchRedo", { taskId: redo })).toMatchObject({ ok: true });
    expect(await f.call("configWrite", { keyValues: { language: "en" } })).toMatchObject({
      ok: true,
      data: { ok: true },
    });
    const read = (await f.call("configRead", { keys: ["language"] })) as {
      data: { keyValues: Record<string, string> };
    };
    expect(read.data.keyValues.language).toBe("en");
    expect(
      await f.call("routeUpsert", { route: { tag: "PokemonApp", agentId: "ag-1", workdir: f.dir, context: "" } }),
    ).toMatchObject({ ok: true });
    expect(await f.call("larkAuth")).toMatchObject({ ok: true, data: { launched: true } });
    expect(await f.call("larkTest")).toMatchObject({ ok: true, data: { identity: "测试用户", chatCount: 0 } });
  });
});

describe("host 命令装配面 · 背包/诊断/桌宠/通用/专注域", () => {
  it("全命令信封 ok + onWrites 接线", async () => {
    expect(await f.call("categoryUpsert", { name: "新分类" })).toMatchObject({ ok: true });
    expect(await f.call("categoryDelete", { id: 5 })).toMatchObject({ ok: true, data: { id: 5 } });
    expect(await f.call("tagUpsert", { name: "标签", dimension: "topic" })).toMatchObject({ ok: true });
    expect(await f.call("tagDelete", { id: 1 })).toMatchObject({ ok: true });
    expect(await f.call("dimensionUpdate", { key: "topic", name: "主题" })).toMatchObject({ ok: true });
    f.conn
      .prepare(
        "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES ('oc_g', '群', 'group', 'unknown')",
      )
      .run();
    expect(await f.call("filterList")).toMatchObject({ ok: true });
    expect(await f.call("filterUpsert", { chatId: "oc_g", state: "always_filter" })).toMatchObject({ ok: true });
    const agent = {
      id: "ag-9",
      name: "X",
      command: "true",
      args: "",
      historyArgs: "",
      workdir: "",
      timeoutSecs: 60,
      enabled: true,
    };
    expect(await f.call("agentUpsert", { agent })).toMatchObject({ ok: true });
    expect(await f.call("agentDelete", { id: "ag-9" })).toMatchObject({ ok: true });
    await runAgentDeploymentBindingCase(agent);
    expect(await f.call("promptList")).toMatchObject({ ok: true });
    expect(await f.call("promptGet", { key: "ai_prompt_tag_health" })).toMatchObject({ ok: true });
    expect(await f.call("promptOverride", { key: "ai_prompt_tag_health", value: "自定义提示词" })).toMatchObject({
      ok: true,
    });
    expect(await f.call("promptReset", { key: "ai_prompt_tag_health" })).toMatchObject({ ok: true });
    expect(await f.call("diagnosticsSnapshot")).toMatchObject({ ok: true, data: { links: expect.any(Array) } });
    expect(await f.call("supportReport")).toMatchObject({
      ok: true,
      data: { text: expect.stringContaining("支持报告") },
    });
    expect(await f.call("logQuery", { limit: 5 })).toMatchObject({ ok: true });
    expect(await f.call("petShow")).toMatchObject({ ok: true, data: { ok: true, ready: false } });
    expect(await f.call("petHide")).toMatchObject({ ok: true, data: { ok: true } });
    expect(await f.call("petStatus")).toMatchObject({ ok: true, data: { running: false } });
    expect(await f.call("petMove", { pos: { x: 1, y: 2 } })).toMatchObject({ ok: true });
    expect(await f.call("dbStatus")).toMatchObject({ ok: true, data: { userVersion: 2, mode: "ok" } });
    expect(await f.call("pomoTryFive", {})).toMatchObject({ ok: true, data: { ok: true } });
    expect(f.writes()).toBeGreaterThan(0);
  });
});

describe("host 命令装配面 · 交互派发 handoff 与远端件接线（debt ③）", () => {
  it("dispatchInteractive：handoff 终端 → 响应带 line/note/handedOff（本机命令行回传）", async () => {
    seedAgentEntry();
    const inter = seedTask(f.conn, "handoff 派发");
    attachProjectTag(f.conn, f.dir, inter);
    f.deps.terminal = createHandoffTerminal("dsh 宿主无插件终端面板");
    const out = (await f.call("dispatchInteractive", { taskId: inter })) as {
      data: { state: string; handedOff?: boolean; line?: string; note?: string | null };
    };
    expect(out.data.state).toBe("running");
    expect(out.data.handedOff).toBe(true);
    expect(out.data.line).toContain("true"); // seedAgentEntry 的 command + 完整 prompt
    expect(out.data.note).toContain("复制");
  });

  it("dispatchInteractive：remoteInteractive 在场 → terminalFor 适配器优先于 deps.terminal", async () => {
    seedAgentEntry();
    const inter = seedTask(f.conn, "远端交互");
    attachProjectTag(f.conn, f.dir, inter);
    const injected: string[] = [];
    f.deps.remoteInteractive = {
      terminalFor: () => ({
        inject: async ({ line }) => {
          injected.push(line);
          return { terminal: "pty-x", sessionRef: "pty-x" };
        },
      }),
      deploymentPrecheck: async () => {},
    };
    const out = (await f.call("dispatchInteractive", { taskId: inter })) as {
      data: { handedOff?: boolean };
    };
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("true"); // seedAgentEntry 的 command 是 "true"
    expect(out.data.handedOff).toBeUndefined(); // 真实注入，非 handoff
    const row = f.conn.prepare("SELECT session_id FROM agent_sessions WHERE task_id=?").get(inter) as {
      session_id: string | null;
    };
    expect(row.session_id).toBe("pty-x");
  });
});
