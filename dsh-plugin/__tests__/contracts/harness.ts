/**
 * 契约回放 harness（FR-X3 · TS 回放侧）：执行 `contracts/scenarios/<group>/<name>.json`
 * → 与 `contracts/fixtures/<group>/<name>.json` 逐字段比对。行为基准 =
 * src-tauri/src/contracts/mod.rs 的 Rust oracle harness（op 执行语义、步后快照、
 * final 全量行集、<ts:N> 时间戳归一、<alias:N> 别名归一逐条对齐；遍历序 = 对象键
 * 字典序 + 数组序）。op 实现表见 ops*.ts（薄转发 src/host 域原语 + 必要的
 * 「harness 组合」——与 Rust oracle 的同名组合镜像）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { open, type Conn } from "../../src/host/storage/db";
import { initConn } from "../../src/host/storage/init";

export const ROOT = join(import.meta.dirname, "..", "..", "..");

/** 场景与夹具的 JSON 形态（PROTOCOL §5） */
export interface Scenario {
  kind: string;
  name: string;
  now?: string;
  setup?: Record<string, unknown>;
  steps: Array<{ op: string; args?: Record<string, unknown> }>;
  expect: string;
}

export interface Fixture {
  scenario: string;
  generatedBy: { impl: string; schemaVersion: number };
  steps: Array<{ ok: boolean; error: string | null; value: unknown; snapshot: unknown }>;
  final: unknown;
}

/** op 执行结果（错误 = 机器稳定 tag，不锁文案——与 oracle 的 error 字段同位） */
export type OpResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface OpCtx {
  /** 第 idx 号连接（concurrency 组 = 同一临时文件库的两条连接） */
  conn(idx: number): Conn;
}

export type OpFn = (ctx: OpCtx, args: Record<string, unknown>) => OpResult;

/** 遍历 scenarios 目录：(group, name)；group 须命中 PROTOCOL §5 kind 全集 */
export function discoverScenarios(): Array<{ group: string; name: string; path: string }> {
  const root = join(ROOT, "contracts", "scenarios");
  const groups = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const out: Array<{ group: string; name: string; path: string }> = [];
  for (const group of groups) {
    const files = readdirSync(join(root, group))
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      out.push({ group, name: file.replace(/\.json$/, ""), path: join(root, group, file) });
    }
  }
  return out;
}

export function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as unknown;
}

// ---- 建库与种子（Rust oracle Harness::new + seed_setup 镜像） ----

const SETUP_TABLES: Array<[string, string]> = [
  ["categories", "categories"],
  ["dimensions", "tag_dimensions"],
  ["tags", "tags"],
  ["tasks", "tasks"],
  ["task_tags", "task_tags"],
  ["task_notes", "task_notes"],
  ["task_logs", "task_logs"],
  ["chat_messages", "chat_messages"],
  ["feishu_users", "feishu_users"],
  ["chats", "feishu_chats"],
  ["filters", "chat_filter_prefs"],
  ["agent_sessions", "agent_sessions"],
  ["dispatch_slots", "dispatch_slots"],
];

/** JSON 值 → SQL 值（Rust json_to_sql 同构：bool→int、数组/对象→JSON 文本） */
function jsonToSql(v: unknown): string | number | null {
  if (v === null) {
    return null;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string") {
    return v;
  }
  return JSON.stringify(v);
}

function seedSetup(conn: Conn, setup: Record<string, unknown> | undefined): void {
  const obj = setup ?? {};
  const settings = obj.settings as Record<string, unknown> | undefined;
  if (settings !== undefined) {
    // Rust oracle 经 serde_json BTreeMap 迭代种子 → 键字典序决定 settings 行的 rowid 序
    for (const key of Object.keys(settings).sort()) {
      const value = settings[key];
      const text = typeof value === "string" ? value : JSON.stringify(value);
      conn
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?2")
        .run(key, text);
    }
  }
  for (const [key, table] of SETUP_TABLES) {
    const rows = obj[key];
    if (!Array.isArray(rows)) {
      continue;
    }
    for (const row of rows) {
      const cols = Object.keys(row as Record<string, unknown>);
      const holders = cols.map(() => "?").join(", ");
      conn
        .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${holders})`)
        .run(...cols.map((c) => jsonToSql((row as Record<string, unknown>)[c])));
    }
  }
}

/** 场景连接集：concurrency 组 = 临时文件库双连接；其余 = 内存单连接 */
export function openScenarioDb(
  kind: string,
  name: string,
  setup: Record<string, unknown> | undefined,
): { conns: Conn[]; cleanup(): void } {
  if (kind === "concurrency") {
    const dir = mkdtempSync(join(tmpdir(), `cy-contracts-${name}-`));
    const path = join(dir, "db.sqlite");
    const conns: Conn[] = [];
    for (let i = 0; i < 2; i++) {
      const conn = open(path);
      initConn(conn);
      if (i === 0) {
        seedSetup(conn, setup);
      }
      conns.push(conn);
    }
    return {
      conns,
      cleanup: () => {
        for (const c of conns) {
          c.close();
        }
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const conn = open(":memory:");
  initConn(conn);
  seedSetup(conn, setup);
  return { conns: [conn], cleanup: () => conn.close() };
}

// ---- 步后快照与终态导出（Rust oracle snapshot/dump_final/invariants 镜像） ----

const DUMP_TABLES = [
  "tasks",
  "task_logs",
  "task_notes",
  "task_tags",
  "tags",
  "tag_dimensions",
  "categories",
  "settings",
  "chat_messages",
  "chat_feedback",
  "dispatch_slots",
  "feishu_users",
  "feishu_chats",
  "chat_filter_prefs",
  "agent_sessions",
];

function count(conn: Conn, sql: string): number {
  return Number((conn.prepare(sql).get() as { n: number }).n);
}

/** 步后确定性快照（不含时间戳字段） */
export function snapshot(conn: Conn): Record<string, unknown> {
  const tasks: Record<string, unknown> = {};
  for (const r of conn
    .prepare("SELECT id, status, dispatch_state, focus_seconds FROM tasks ORDER BY id")
    .all() as Array<Record<string, unknown>>) {
    tasks[String(r.id)] = { status: r.status, dispatch: r.dispatch_state, focusSeconds: r.focus_seconds };
  }
  const messages: Record<string, unknown> = {};
  for (const r of conn
    .prepare("SELECT message_id, ai_status, review_status FROM chat_messages ORDER BY id")
    .all() as Array<Record<string, unknown>>) {
    messages[String(r.message_id)] = { ai: r.ai_status, review: r.review_status };
  }
  const slots = (
    conn.prepare("SELECT host_key, task_id FROM dispatch_slots ORDER BY host_key, task_id").all() as Array<
      Record<string, unknown>
    >
  ).map((r) => [r.host_key, r.task_id]);
  return {
    tasks,
    messages,
    slots,
    auditCount: count(conn, "SELECT COUNT(*) AS n FROM task_logs"),
    noteCount: count(conn, "SELECT COUNT(*) AS n FROM task_notes"),
    feedbackCount: count(conn, "SELECT COUNT(*) AS n FROM chat_feedback"),
    tagCount: count(conn, "SELECT COUNT(*) AS n FROM tags"),
  };
}

/** final 全量行集（行序 = rowid；BLOB → hex 文本——Rust dump_table 同构） */
export function dumpFinal(conn: Conn): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const table of DUMP_TABLES) {
    const rows = conn.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Array<Record<string, unknown>>;
    out[table] = rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        mapped[k] = v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v;
      }
      return mapped;
    });
  }
  return out;
}
