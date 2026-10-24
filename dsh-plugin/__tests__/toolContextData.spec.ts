/**
 * tools/contextData 数据面单测（pk context.rs 同构面的分支收口）：词表构建（假名化
 * scrub / 分类/维度投影）、标签移除负反馈（窗口/阈值/封顶）、分类与标签名解析的
 * 正负路径。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAndInit } from "../src/host/storage/init";
import type { Conn } from "../src/host/storage/db";
import { buildToolContextData, categoryIdByName, tagIdsByNames } from "../src/host/tools/contextData";
import { setSetting } from "../src/host/domain/settings";

let dir: string;
let conn: Conn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-ctx-data-"));
  conn = openAndInit(join(dir, "data", "test.db")).conn;
});
afterEach(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 落一条标签 diff 日志行（removalFeedback 数据源） */
function seedTagDiff(oldValue: string, newValue: string, at: string): void {
  conn
    .prepare(
      "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
        "VALUES (1, 'update', 'tags', ?, ?, 'dsh:tools', ?)",
    )
    .run(oldValue, newValue, at);
}

describe("buildToolContextData（词表构建）", () => {
  it("空库基线：开放任务/分类/标签投影结构齐备，now 为本地分钟形态", () => {
    const data = buildToolContextData(conn);
    expect(Object.keys(data).sort()).toEqual(["categories", "dimensions", "now", "openTasks", "tagFeedback", "tags"]);
    expect(String(data.now)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(data.openTasks).toEqual([]);
    expect((data.categories as unknown[]).length).toBeGreaterThan(0); // 种子分类
    expect((data.dimensions as unknown[]).length).toBeGreaterThan(0); // 种子维度
  });

  it("开放任务与停用分类投影：只列启用分类；任务标题过假名化", () => {
    // 假名化词表：feishu_users 他人名 → 别名替换（AnonRules.build 收集面）
    conn.prepare("INSERT INTO feishu_users (open_id, name, alias) VALUES ('ou-other', '机密', '□□')").run();
    setSetting(conn, "feishu_my_open_id", "ou-me");
    conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES (?, 'inbox', '2026-01-01T00:00:00+00:00')")
      .run("机密项目X");
    conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES ('完工', 'done', '2026-01-01T00:00:00+00:00')")
      .run();
    const data = buildToolContextData(conn);
    expect(data.openTasks).toEqual([{ id: 1, title: "□□项目X" }]); // done 不进开放集 + scrub 生效
  });

  it("标签移除负反馈：同标签 30 天内 ≥2 次移除入表（封顶 3 条、按次数排序）", () => {
    const at = new Date(Date.now() - 86_400_000).toISOString().replace("Z", "+00:00");
    seedTagDiff("a,b,c", "a", at); // 移除 b、c 各 1
    seedTagDiff("b,c", "", at); // b、c 各 +1 → 各 2
    seedTagDiff("d", "", at); // d 仅 1 次 → 不入
    const data = buildToolContextData(conn);
    expect(data.tagFeedback).toEqual([
      { name: "b", removed: 2 },
      { name: "c", removed: 2 },
    ]);
  });

  it("移除负反馈：空 old / 全保留 / 窗口外不计", () => {
    seedTagDiff("", "x", new Date().toISOString());
    seedTagDiff("", "", new Date().toISOString());
    seedTagDiff("keep", "keep", new Date().toISOString()); // 无移除
    seedTagDiff("old-window", "", "2025-01-01T00:00:00+00:00"); // 窗口外
    const data = buildToolContextData(conn);
    expect(data.tagFeedback).toEqual([]);
  });
});

describe("分类/标签名解析", () => {
  it("categoryIdByName：命中启用分类；停用/未知名 → 参数错", () => {
    const first = conn.prepare("SELECT name FROM categories WHERE enabled=1 LIMIT 1").get() as { name: string };
    expect(categoryIdByName(conn, first.name)).toBeGreaterThan(0);
    expect(() => categoryIdByName(conn, "不存在的分类")).toThrowError(/未知分类/);
  });

  it("tagIdsByNames：按名全局命中；空白过滤；未知名 → 参数错", () => {
    conn.prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('焦点', 1, NULL, 't')").run();
    expect(tagIdsByNames(conn, [" 焦点 ", "", "  "])).toHaveLength(1); // trim 归一 + 空白过滤
    expect(() => tagIdsByNames(conn, ["幻影"])).toThrowError(/未知标签/);
  });
});
