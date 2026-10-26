import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
// vite ?raw 编译期加载契约 SQL（环境无关——happy-dom 下 import.meta.url 非 file 协议，不走 fs 相对解析）
import schema001 from "../../contracts/schema/001_v1.sql?raw";
import { apply, probeNodeSqlite, unsupportedSqliteError, type SqliteCapability } from "../src/host/index";

describe("A1 能力探测：node:sqlite（AD NFR-3 ②）", () => {
  it("仓库工具链 Node ≥ 24：node:sqlite 可开可用（实测口径见 docs/compatibility.md）", () => {
    const capability = probeNodeSqlite();
    expect(capability.ok).toBe(true);
    expect(capability.nodeVersion).toBe(process.versions.node);
  });

  it("apply 在探测失败时抛带指引的载入拒绝错误（不静默半工作）", () => {
    const broken: SqliteCapability = { ok: false, nodeVersion: "22.5.0", detail: "no such module" };
    expect(() => apply({}, () => broken)).toThrowError(/node:sqlite 不可用/);
    expect(() => apply({}, () => broken)).toThrowError(/≥ 24/);
    expect(() => apply({}, () => broken)).toThrowError(/better-sqlite3/);
  });

  it("apply 探测通过时不抛（惰性注册骨架）", () => {
    expect(() => apply({})).not.toThrow();
  });

  it("错误文案含失败详情；无详情时指引仍完整", () => {
    expect(unsupportedSqliteError({ ok: false, nodeVersion: "22.5.0", detail: "boom" }).message).toContain("boom");
    expect(unsupportedSqliteError({ ok: false, nodeVersion: "22.5.0" }).message).toContain("better-sqlite3");
  });
});

describe("契约 schema 冒烟（与 A1 实测同口径）", () => {
  it("contracts/schema 基线 SQL 可在内存库执行，业务表集完整", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(schema001);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    // 16 张业务表；sqlite_sequence 为内部表不计入
    expect(tables).toEqual(
      expect.arrayContaining([
        "agent_sessions",
        "categories",
        "chat_feedback",
        "chat_filter_prefs",
        "chat_messages",
        "dispatch_slots",
        "feishu_chats",
        "feishu_users",
        "settings",
        "sync_state",
        "tag_dimensions",
        "tags",
        "task_logs",
        "task_notes",
        "task_tags",
        "tasks",
      ]),
    );
    db.close();
  });
});
