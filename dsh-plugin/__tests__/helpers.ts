/**
 * 测试公共件：真实临时 SQLite 文件库（node:sqlite 而非纯 mock——并发用例需双连接，
 * AD §4.4/§7.3「宿主半边集成测试 = 伪 ctx 驱动真实 host 模块 + 真实临时 SQLite 文件」）。
 * 每个测试自建库自清理；openAndInit 完成迁移 + 种子（对齐 Rust test_conn 起点）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, type Conn } from "../src/host/storage/db";
import { initConn } from "../src/host/storage/init";
import { LogRing } from "../src/host/health/logRing";
import { HealthState } from "../src/host/health/snapshot";
import { createFakeTerminal } from "../src/host/dispatch/interactive";
import type { HostCommandDeps } from "../src/host/commands";

export interface TestDb {
  conn: Conn;
  path: string;
  dir: string;
  /** 另开一条连接到同一库文件（并发用例：双连接） */
  secondConn(): Conn;
  close(): void;
}

/** 建临时目录 + 库文件连接（迁移 + 种子），测试结束后清理（含 WAL 伴生文件） */
export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "pky-dsh-"));
  const path = join(dir, "test.db");
  const conn = open(path);
  initConn(conn);
  const extras: Conn[] = [];
  return {
    conn,
    path,
    dir,
    secondConn() {
      const extra = open(path);
      extras.push(extra);
      return extra;
    },
    close() {
      conn.close();
      for (const extra of extras) {
        try {
          extra.close();
        } catch {
          // 已关闭的连接忽略
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 直接插一条任务（绕过命令层构造初始态，对齐 Rust 测试的 seed 手法） */
export function seedTask(
  conn: Conn,
  title: string,
  opts: { status?: string; dueAt?: string | null; startedAt?: string | null } = {},
): number {
  const result = conn
    .prepare(
      "INSERT INTO tasks (title, status, due_at, started_at, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(title, opts.status ?? "inbox", opts.dueAt ?? null, opts.startedAt ?? null);
  return Number(result.lastInsertRowid);
}

const INSERT_MESSAGE_SQL =
  "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_note, " +
  "suggested_category, suggested_due, suggested_priority, suggested_tags, ai_status, " +
  "review_status, update_task_id, ai_agent, chat_type, created_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00+00:00')";

interface ChatSeed {
  content: string;
  suggestedTitle: string | null;
  suggestedNote: string | null;
  suggestedCategory: string | null;
  suggestedDue: string | null;
  suggestedPriority: string | null;
  suggestedTags: string;
  aiStatus: string;
  reviewStatus: string;
  updateTaskId: number | null;
  aiAgent: string;
  chatType: string;
}

/** 直接插一条聊天消息（review/suggest 测试的公共起点） */
export type ChatSeedInput = Partial<ChatSeed>;

export function seedMessage(conn: Conn, messageId: string, opts: ChatSeedInput = {}): number {
  const defaults: ChatSeed = {
    content: "内容",
    suggestedTitle: null,
    suggestedNote: null,
    suggestedCategory: null,
    suggestedDue: null,
    suggestedPriority: null,
    suggestedTags: "[]",
    aiStatus: "pending",
    reviewStatus: "pending",
    updateTaskId: null,
    aiAgent: "",
    chatType: "",
  };
  const o: Required<ChatSeed> = { ...defaults, ...opts };
  const args = [
    messageId,
    o.content,
    o.suggestedTitle,
    o.suggestedNote,
    o.suggestedCategory,
    o.suggestedDue,
    o.suggestedPriority,
    o.suggestedTags,
    o.aiStatus,
    o.reviewStatus,
    o.updateTaskId,
    o.aiAgent,
    o.chatType,
  ];
  const result = conn.prepare(INSERT_MESSAGE_SQL).run(...args);
  return Number(result.lastInsertRowid);
}

/** 直接插一个 agent 配置到 ai_agents 设置（queue_due 的可用性判定起点） */
export function seedAgents(
  conn: Conn,
  agents: Array<{ id: string; command?: string; enabled?: boolean; host?: string }>,
): void {
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify(
      agents.map((a) => ({
        id: a.id,
        name: a.id,
        command: a.command ?? "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: a.enabled ?? true,
        ...(a.host ? { remote: { host: a.host, port: 22, persistent: false } } : {}),
      })),
    ),
  );
}

/** 建标签（直接落库，绕过配额/幂等逻辑——对齐 Rust seed_tag_dim） */
export function seedTag(conn: Conn, name: string, dimensionKey = "topic"): number {
  const dimId = (conn.prepare("SELECT id FROM tag_dimensions WHERE key=?").get(dimensionKey) as { id: number }).id;
  const result = conn
    .prepare("INSERT INTO tags (name, description, dimension_id, created_at) VALUES (?, '', ?, '2026-01-01')")
    .run(name, dimId);
  return Number(result.lastInsertRowid);
}

/** 读单行单列便捷件 */
export function scalar(conn: Conn, sql: string, ...args: unknown[]): unknown {
  const row = conn.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.values(row)[0];
}

/** host 命令装配测试的最小 deps（poll/lark/pet 全替身——读命令面不触碰这些面） */
export function commandDeps(conn: Conn, opts: { onWrites?: () => void } = {}): HostCommandDeps {
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
    newExecutor: () => null,
    dispatchDeps: { executorFor: () => undefined as never },
    terminal: createFakeTerminal(),
    pet: { show: async () => undefined, hide: () => undefined, running: false },
    onWrites: opts.onWrites ?? (() => undefined),
    openPage: () => undefined,
    feishuConfigured: true,
    meta: { pluginVersion: "0.1.0", dshVersion: null },
  };
}
