/**
 * commands.spec 系公共件：临时库 + 完整 deps 装配（fake lark/poll/pet/terminal +
 * 可执行 judge/派发替身——比 helpers.commandDeps 多执行面，派发/重判 happy path 可
 * 走通）+ 命令调用/种子便捷件（commands.spec 与 commands-misc.spec 共用）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostCommands, type HostCommandDeps } from "../src/host/commands";
import { initConn } from "../src/host/storage/init";
import { open, type Conn } from "../src/host/storage/db";
import { LogRing } from "../src/host/health/logRing";
import { HealthState } from "../src/host/health/snapshot";
import { createFakeTerminal } from "../src/host/dispatch/terminalAdapters";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import type { DispatchExecutor, ExecOutcome } from "../src/host/dispatch/executor";

export interface CommandsFixture {
  /** 临时库连接（已迁移 + 种子） */
  conn: Conn;
  /** 临时根（派发 workdir / 备份 HOME 注入用） */
  dir: string;
  /** openPage 接线记录（section 入参） */
  pages: Array<{ section?: string }>;
  /** onWrites 计数（live 读取） */
  writes(): number;
  /** 命令面调用便捷件 */
  call(name: string, params?: unknown): Promise<unknown>;
  /** 完整 deps（个别用例按需覆写——如 agentTest 探针执行器的 stdout） */
  deps: HostCommandDeps;
  /** 关库 + 清理临时目录 */
  close(): void;
}

function fullDeps(conn: Conn, onWrites: () => void, openPage: (section?: string) => void): HostCommandDeps {
  return {
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
    pet: { show: async () => null, hide: () => undefined, running: false },
    onWrites,
    openPage,
    feishuConfigured: true,
    meta: { pluginVersion: "0.1.0", dshVersion: null },
  };
}

export function createCommandsFixture(): CommandsFixture {
  const dir = mkdtempSync(join(tmpdir(), "pky-cmds-"));
  const conn = open(join(dir, "test.db"));
  initConn(conn);
  const pages: Array<{ section?: string }> = [];
  let writes = 0;
  const deps = fullDeps(
    conn,
    () => (writes += 1),
    (section) => pages.push({ section }),
  );
  return {
    conn,
    dir,
    pages,
    writes: () => writes,
    /** 完整 deps（个别用例按需覆写，如 agentTest 的探针执行器 stdout） */
    deps,
    call: (name: string, params?: unknown) => createHostCommands(deps)(name, params),
    close() {
      conn.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 直插任务（返回 id；opts 补状态/派发态） */
export function seedTask(conn: Conn, title: string, opts: { status?: string; dispatch?: string | null } = {}): number {
  const r = conn
    .prepare(
      "INSERT INTO tasks (title, status, dispatch_state, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(title, opts.status ?? "scheduled", opts.dispatch ?? null);
  return Number(r.lastInsertRowid);
}

/** 项目标签（派发路由的前提：project 维度 + meta 指定 agent）并挂到任务 */
export function attachProjectTag(conn: Conn, dir: string, taskId: number): void {
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
export function seedMsg(
  conn: Conn,
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
