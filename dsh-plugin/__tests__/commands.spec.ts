/**
 * host 命令装配面：49+1 命令完整性（HOST_COMMAND_NAMES 单源）+ 每命令至少一个
 * happy path 调用（信封 ok / data 落库；全命令覆盖装配层，细节行为已有各域单测）。
 * deps 走 createHostCommands 直装（fake lark/poll/pet/terminal——不经 createPlugin，
 * 插件级装配链路由 integration.spec 覆盖）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { createHostCommands, HOST_COMMAND_NAMES } from "../src/host/commands";
import type { HostCommandDeps } from "../src/host/commands";
import { initConn } from "../src/host/storage/init";
import { open } from "../src/host/storage/db";
import { LogRing } from "../src/host/health/logRing";
import { HealthState } from "../src/host/health/snapshot";
import { createFakeTerminal } from "../src/host/dispatch/interactive";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import type { DispatchExecutor, ExecOutcome } from "../src/host/dispatch/executor";

let dir: string;
let conn: ReturnType<typeof open>;
let pages: Array<{ section?: string }>;
let writes: number;
let deps: HostCommandDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-cmds-"));
  conn = open(join(dir, "test.db"));
  initConn(conn);
  pages = [];
  writes = 0;
  deps = {
    conn,
    health: new HealthState(),
    logs: new LogRing(),
    log: () => undefined,
    poll: { runRound: async () => ({ ok: true, inserted: 0, unauthorized: false }), resume: () => undefined },
    lark: {
      userIdentity: async () => ({ openId: "ou_me", name: "测试用户" }),
      listChats: async () => ({ items: [] }),
      chatUserSettings: async () => ({}),
      listMessages: async () => ({}),
      listMembers: async () => ({}),
      authStatus: async () => ({ loggedIn: true, userName: "测试用户" }),
      configReady: async () => true,
    },
    larkBin: "lark-cli",
    newExecutor: () =>
      fakeSubagentExecutor("fake-judge", (batch) => [
        { messageId: batch.messageIds[0] ?? "", action: "todo", title: "快捕任务" },
      ]),
    dispatchDeps: {
      executorFor: (): DispatchExecutor => ({
        launch: async (): Promise<ExecOutcome> => ({ exitCode: 0, durationMs: 5, stdout: "", timedOut: false }),
        kill: () => undefined,
      }),
    },
    terminal: createFakeTerminal(),
    pet: { show: async () => undefined, hide: () => undefined, running: false },
    onWrites: () => (writes += 1),
    openPage: (section) => pages.push({ section }),
    feishuConfigured: true,
    meta: { pluginVersion: "0.1.0", dshVersion: null },
  };
});

afterEach(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (name: string, params?: unknown): Promise<unknown> => createHostCommands(deps)(name, params);

/** 直插任务（返回 id；opts 补状态/派发态） */
function seedTask(title: string, opts: { status?: string; dispatch?: string | null } = {}): number {
  const r = conn
    .prepare(
      "INSERT INTO tasks (title, status, dispatch_state, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(title, opts.status ?? "scheduled", opts.dispatch ?? null);
  return Number(r.lastInsertRowid);
}

/** 项目标签（派发路由的前提：project 维度 + meta 指定 agent）并挂到任务 */
function attachProjectTag(taskId: number): void {
  conn
    .prepare(
      "INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('PokemonApp', 1, ?, '2026-01-01T00:00:00+00:00') ON CONFLICT(name, dimension_id) DO UPDATE SET meta=excluded.meta",
    )
    .run(JSON.stringify({ agentId: "ag-1", workdir: dir }));
  const tagId = Number(
    (conn.prepare("SELECT id FROM tags WHERE name='PokemonApp' AND dimension_id=1").get() as { id: number }).id,
  );
  conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
}

/** 直插消息（快捕/分诊/重判的种子） */
function seedMsg(
  messageId: string,
  opts: { aiStatus?: string; review?: string; title?: string; updateTask?: number | null } = {},
): void {
  conn
    .prepare(
      "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_tags, ai_status, review_status, update_task_id, created_at) " +
        "VALUES (?, '内容', ?, '[]', ?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(messageId, opts.title ?? null, opts.aiStatus ?? "pending", opts.review ?? "pending", opts.updateTask ?? null);
}

describe("host 命令装配面（AD §4.1.1）· 全集与任务域", () => {
  it("命令名全集 = 55 条目（54 RPC + taskDeleteUndo 撤销面），未知命令 INVALID_ARGUMENT", async () => {
    expect(HOST_COMMAND_NAMES).toHaveLength(55);
    const unknown = (await call("nope")) as { ok: boolean; error: { code: string } };
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe("INVALID_ARGUMENT");
  });

  it("任务域：Start/Pause/Resume/Complete/Cancel/Delete/Undo/Reschedule", async () => {
    const id = seedTask("命令面任务");
    expect(await call("taskStart", { taskId: id })).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await call("taskPause", {})).toMatchObject({ ok: true });
    expect(await call("taskResume", {})).toMatchObject({ ok: true });
    const done = seedTask("完成目标", { status: "active" });
    expect(await call("taskComplete", { taskId: done })).toMatchObject({ ok: true });
    const esc = seedTask("逃走目标");
    expect(await call("taskCancel", { taskId: esc, reasonCode: "noise" })).toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    const del = seedTask("放生目标");
    expect(await call("taskDelete", { taskId: del })).toEqual({ ok: true, data: { taskId: del } });
    expect(await call("taskDeleteUndo", { taskId: del })).toMatchObject({ ok: true, data: { id: del } });
    const rs = seedTask("改期目标");
    expect(await call("taskReschedule", { taskId: rs, due: "2026-06-01T09:00" })).toMatchObject({ ok: true });
  });
});

describe("host 命令装配面 · 收音机域", () => {
  it("快捕与分诊四路 + 放生撤销窗口外参数错", async () => {
    const stale = (await call("taskDeleteUndo", { taskId: 424242 })) as { ok: boolean; error: { code: string } };
    expect(stale.error.code).toBe("INVALID_ARGUMENT");
    expect(await call("captureTodo", { text: "记得买咖啡" })).toMatchObject({ ok: true, data: { outcome: "caught" } });
    seedMsg("om_acc", { aiStatus: "todo", title: "待接受" });
    expect(await call("reviewAccept", { messageId: "om_acc" })).toMatchObject({
      ok: true,
      data: { messageId: "om_acc" },
    });
    const upd = seedTask("更新目标");
    seedMsg("om_upd", { aiStatus: "update", title: "改名", updateTask: upd });
    expect(await call("reviewApplyUpdate", { messageId: "om_upd" })).toMatchObject({ ok: true, data: { taskId: upd } });
    seedMsg("om_dis");
    expect(await call("reviewDismiss", { messageId: "om_dis", reasonCode: "noise" })).toMatchObject({ ok: true });
    seedMsg("om_res");
    await call("reviewDismiss", { messageId: "om_res", reasonCode: "noise" });
    expect(await call("reviewRestore", { messageId: "om_res" })).toMatchObject({ ok: true });
  });

  it("批量分诊 / 失败组 / 手动拉取", async () => {
    seedMsg("om_b1", { aiStatus: "todo", title: "批一" });
    seedMsg("om_b2", { aiStatus: "todo", title: "批二" });
    const batch = (await call("reviewBatch", {
      messageIds: ["om_b1", "om_b2"],
      op: "dismiss",
      reasonCode: "noise",
    })) as {
      data: { results: Array<{ ok: boolean }> };
    };
    expect(batch.data.results.every((r) => r.ok)).toBe(true);
    seedMsg("om_err", { aiStatus: "error", review: "pending" });
    expect(await call("retryJudge", { messageIds: ["om_err"] })).toMatchObject({ ok: true });
    seedMsg("om_fc", { aiStatus: "none" });
    expect(await call("forceCapture", { messageId: "om_fc" })).toMatchObject({ ok: true });
    seedMsg("om_fd");
    expect(await call("forceDismiss", { messageId: "om_fd", reasonCode: "noise" })).toMatchObject({ ok: true });
    expect(await call("pollNow")).toMatchObject({ ok: true });
  });
});

describe("host 命令装配面 · 派发与设置域", () => {
  it("六派发 + config/route/lark", async () => {
    conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
      JSON.stringify([
        {
          id: "ag-1",
          name: "A",
          command: "true",
          args: "",
          historyArgs: "",
          workdir: dir,
          timeoutSecs: 120,
          enabled: true,
        },
      ]),
    );
    const inter = seedTask("交互派发");
    attachProjectTag(inter);
    expect(await call("dispatchInteractive", { taskId: inter })).toMatchObject({
      ok: true,
      data: { state: "running" },
    });
    const head = seedTask("无头派发");
    attachProjectTag(head);
    expect(await call("dispatchHeadless", { taskId: head })).toMatchObject({ ok: true });
    const closing = seedTask("收口目标", { dispatch: "running" });
    expect(await call("dispatchClose", { taskId: closing, result: "done", note: "完成" })).toMatchObject({
      ok: true,
      data: { state: "done" },
    });
    const reset = seedTask("重置目标", { dispatch: "running" });
    expect(await call("dispatchReset", { taskId: reset })).toMatchObject({ ok: true });
    const cancel = seedTask("取消排队", { dispatch: "queued" });
    expect(await call("dispatchCancel", { taskId: cancel })).toMatchObject({ ok: true });
    const redo = seedTask("重派目标", { dispatch: "done" });
    attachProjectTag(redo);
    expect(await call("dispatchRedo", { taskId: redo })).toMatchObject({ ok: true });
    expect(await call("configWrite", { keyValues: { language: "en" } })).toMatchObject({
      ok: true,
      data: { ok: true },
    });
    const read = (await call("configRead", { keys: ["language"] })) as { data: { keyValues: Record<string, string> } };
    expect(read.data.keyValues.language).toBe("en");
    expect(
      await call("routeUpsert", { route: { tag: "PokemonApp", agentId: "ag-1", workdir: dir, context: "" } }),
    ).toMatchObject({ ok: true });
    expect(await call("larkAuth")).toMatchObject({ ok: true, data: { launched: true } });
    expect(await call("larkTest")).toMatchObject({ ok: true, data: { identity: "测试用户", chatCount: 0 } });
  });
});

describe("host 命令装配面 · 背包/诊断/桌宠/通用/专注域", () => {
  it("全命令信封 ok + onWrites 接线", async () => {
    expect(await call("categoryUpsert", { name: "新分类" })).toMatchObject({ ok: true });
    expect(await call("categoryDelete", { id: 5 })).toMatchObject({ ok: true, data: { id: 5 } });
    expect(await call("tagUpsert", { name: "标签", dimension: "topic" })).toMatchObject({ ok: true });
    expect(await call("tagDelete", { id: 1 })).toMatchObject({ ok: true });
    expect(await call("dimensionUpdate", { key: "topic", name: "主题" })).toMatchObject({ ok: true });
    conn
      .prepare(
        "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES ('oc_g', '群', 'group', 'unknown')",
      )
      .run();
    expect(await call("filterList")).toMatchObject({ ok: true });
    expect(await call("filterUpsert", { chatId: "oc_g", state: "always_filter" })).toMatchObject({ ok: true });
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
    expect(await call("agentUpsert", { agent })).toMatchObject({ ok: true });
    expect(await call("agentDelete", { id: "ag-9" })).toMatchObject({ ok: true });
    expect(await call("promptList")).toMatchObject({ ok: true });
    expect(await call("promptGet", { key: "ai_prompt_tag_health" })).toMatchObject({ ok: true });
    expect(await call("promptOverride", { key: "ai_prompt_tag_health", value: "自定义提示词" })).toMatchObject({
      ok: true,
    });
    expect(await call("promptReset", { key: "ai_prompt_tag_health" })).toMatchObject({ ok: true });
    expect(await call("diagnosticsSnapshot")).toMatchObject({ ok: true, data: { links: expect.any(Array) } });
    expect(await call("supportReport")).toMatchObject({
      ok: true,
      data: { text: expect.stringContaining("支持报告") },
    });
    expect(await call("logQuery", { limit: 5 })).toMatchObject({ ok: true });
    expect(await call("petShow")).toMatchObject({ ok: true, data: { ok: true } });
    expect(await call("petHide")).toMatchObject({ ok: true, data: { ok: true } });
    expect(await call("petMove", { pos: { x: 1, y: 2 } })).toMatchObject({ ok: true });
    expect(await call("dbStatus")).toMatchObject({ ok: true, data: { userVersion: 2, mode: "ok" } });
    expect(await call("pomoTryFive", {})).toMatchObject({ ok: true, data: { ok: true } });
    expect(writes).toBeGreaterThan(0);
  });
});

describe("host 命令装配面 · 实体读域", () => {
  it("5 命令信封 ok（细节形状断言见 readCommands.spec）", async () => {
    seedTask("实体读目标");
    expect(await call("panelSnapshot", {})).toMatchObject({
      ok: true,
      data: { adventure: { active: [], dueToday: [], overdue: [] }, radio: { health: expect.any(Object) } },
    });
    expect(await call("taskDetail", { taskId: 1 })).toMatchObject({ ok: true, data: { task: { id: 1 } } });
    expect(await call("taskSearch", { query: "实体" })).toMatchObject({ ok: true, data: { tasks: [{ id: 1 }] } });
    expect(await call("todayTasks", {})).toMatchObject({ ok: true, data: { tasks: expect.any(Array) } });
    expect(await call("categoriesList", {})).toMatchObject({ ok: true, data: { categories: expect.any(Array) } });
  });
});
