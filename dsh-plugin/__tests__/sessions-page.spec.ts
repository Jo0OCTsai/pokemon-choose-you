/**
 * dispatch/sessions 扩展（FR-C2 / AD §4.1）：sessionsPage 分页查询（归组映射
 * UIUX §3.1 M9、limit 钳 1–100 默认 20、offset 分页、id 倒序、counts 不随翻页变化）
 * + sessionReplay 回放路由（本机三分支 / 远端部署唤起 / 快照压过当前配置 /
 * ReplayLauncher 注入与错误转发映射）。归组口径 = M9：未知/新增来源仅入「全部」
 * 不进三组（与桌面 other = NOT IN 语义有意分歧，以 UIUX M9 为准——报告标注）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logAgentSession, sessionsPage } from "../src/host/dispatch/sessions";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 插一行会话并返回行 id（快照字段按需覆盖） */
function seedRow(kind: string, extra: Partial<Parameters<typeof logAgentSession>[1]> = {}): number {
  return logAgentSession(db.conn, { agentId: "ag-1", kind, status: "ok", ...extra });
}

const idsOf = (r: ReturnType<typeof sessionsPage>): number[] => r.rows.map((x) => x.id);

/** 快照字段用例的落库输入（remote 三元组 + 计量面全量覆盖） */
const EXPECTED_SNAPSHOT_INPUT: Partial<Parameters<typeof logAgentSession>[1]> = {
  agentId: "ag-x",
  sessionId: "s-1",
  command: "claude -p x",
  exitCode: 0,
  durationMs: 1200,
  costUsd: 0.5,
  inputTokens: 10,
  outputTokens: 20,
  workdir: "/remote/ws",
  remoteHost: "gpu-1",
  remotePort: 2222,
  remoteKey: "/keys/id",
};

/** 快照字段用例的期望投影（camelCase 行形状） */
const EXPECTED_SNAPSHOT_SHAPE = {
  id: 1,
  taskId: null,
  agentId: "ag-x",
  agentName: "ag-x",
  sessionId: "s-1",
  command: "claude -p x",
  exitCode: 0,
  status: "ok",
  durationMs: 1200,
  costUsd: 0.5,
  inputTokens: 10,
  outputTokens: 20,
  kind: "dispatch_headless",
  workdir: "/remote/ws",
  tmuxSession: "",
  remoteHost: "gpu-1",
  remotePort: 2222,
  remoteKey: "/keys/id",
};

describe("sessionsPage：归组映射（M9）", () => {
  function seedSeven(): void {
    seedRow("classify");
    seedRow("capture");
    seedRow("dispatch_headless");
    seedRow("dispatch_interactive");
    seedRow("pk");
    seedRow(""); // 早期记录（kind 空串）
    seedRow("future_kind"); // 未来新增来源
  }

  it("radio = classify/capture；dispatch = dispatch_*；other = pk；id 倒序", () => {
    seedSeven();
    expect(idsOf(sessionsPage(db.conn, { group: "radio" }))).toEqual([2, 1]);
    expect(idsOf(sessionsPage(db.conn, { group: "dispatch" }))).toEqual([4, 3]);
    expect(idsOf(sessionsPage(db.conn, { group: "other" }))).toEqual([5]);
  });

  it("未知来源与空 kind 仅入「全部」，不进三组（M9——other 只含 pk）", () => {
    seedSeven();
    const all = sessionsPage(db.conn, {});
    expect(idsOf(all)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(all.total).toBe(7);
    // 空串与 future_kind 不出现在任何分组（radio/dispatch/other 的 total 均不含它们）
    expect(sessionsPage(db.conn, { group: "radio" }).total).toBe(2);
    expect(sessionsPage(db.conn, { group: "dispatch" }).total).toBe(2);
    expect(sessionsPage(db.conn, { group: "other" }).total).toBe(1);
  });

  it("counts 四档汇总不随分组/翻页变化", () => {
    seedSeven();
    const counts = { all: 7, radio: 2, dispatch: 2, other: 1 };
    expect(sessionsPage(db.conn, {}).counts).toEqual(counts);
    expect(sessionsPage(db.conn, { group: "radio", limit: 1, offset: 1 }).counts).toEqual(counts);
    expect(sessionsPage(db.conn, { group: "other", offset: 100 }).counts).toEqual(counts);
  });

  it("未知分组值按 all 处理", () => {
    seedSeven();
    const unknown = sessionsPage(db.conn, { group: "whatever" });
    expect(unknown.total).toBe(7);
    expect(unknown.rows).toHaveLength(7);
  });
});

describe("sessionsPage：分页边界", () => {
  it("id 倒序 + limit/offset 翻页；offset 越界回空页且 total/counts 不变", () => {
    for (let i = 0; i < 5; i += 1) {
      seedRow("pk");
    }
    expect(idsOf(sessionsPage(db.conn, { limit: 3 }))).toEqual([5, 4, 3]);
    expect(idsOf(sessionsPage(db.conn, { limit: 3, offset: 3 }))).toEqual([2, 1]);
    const beyond = sessionsPage(db.conn, { limit: 3, offset: 6 });
    expect(beyond.rows).toEqual([]);
    expect(beyond.total).toBe(5);
  });

  it("limit 钳 1–100：0 与 1 → 1 行、100 → 100 行、101 → 钳到 100；缺省 20", () => {
    for (let i = 0; i < 105; i += 1) {
      seedRow("pk");
    }
    expect(sessionsPage(db.conn, { limit: 0 }).rows).toHaveLength(1);
    expect(sessionsPage(db.conn, { limit: 1 }).rows).toHaveLength(1);
    expect(sessionsPage(db.conn, { limit: 100 }).rows).toHaveLength(100);
    expect(sessionsPage(db.conn, { limit: 101 }).rows).toHaveLength(100);
    expect(sessionsPage(db.conn, {}).rows).toHaveLength(20);
  });

  it("offset 负值按 0（不炸）", () => {
    for (let i = 0; i < 3; i += 1) {
      seedRow("pk");
    }
    expect(idsOf(sessionsPage(db.conn, { limit: 10, offset: -5 }))).toEqual([3, 2, 1]);
  });
});

describe("sessionsPage：行快照字段", () => {
  it("行快照字段完整（remote 三元组 + workdir 供回放路由与徽章呈现）", () => {
    seedRow("dispatch_headless", EXPECTED_SNAPSHOT_INPUT);
    const row = sessionsPage(db.conn, {}).rows[0];
    expect(row).toMatchObject(EXPECTED_SNAPSHOT_SHAPE);
    expect(row.createdAt).toBeTruthy();
  });
});
