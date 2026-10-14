/**
 * 备份/导出域（domain/backup.ts + 命令面 backupRun/backupList/exportRun）：真库夹具
 * 落盘断言——快照可独立打开且不含 WAL 垃圾、文件命名对齐桌面产物、backup_keep 滚动
 * 保留删旧、三种导出产物内容（JSON 表数据与设置排除面 / CSV BOM 表头与转义 / 日报三段）。
 * 命令面经 CHOOSE_YOU_HOME 注入临时根（Rust 测试 inject_home 同手法）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostCommands } from "../src/host/commands";
import { backupDir, exportsDir, todayStr } from "../src/host/domain/backup";
import { HOME_ENV } from "../src/host/storage/paths";
import { commandDeps, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
let prevHome: string | undefined;
let caller: ReturnType<typeof createHostCommands>;

beforeEach(() => {
  db = createTestDb();
  prevHome = process.env[HOME_ENV];
  process.env[HOME_ENV] = db.dir;
  caller = createHostCommands(commandDeps(db.conn));
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env[HOME_ENV];
  } else {
    process.env[HOME_ENV] = prevHome;
  }
  db.close();
});

/** 命令面返回数据解包（信封 ok 已由调用方断言） */
function data<T>(result: { ok: boolean; data?: unknown }): T {
  expect(result.ok).toBe(true);
  return result.data as T;
}

/** 直插任务（对齐 Rust seed 手法） */
function seedTask(title: string, opts: { status?: string; completedAt?: string } = {}): number {
  const r = db.conn
    .prepare(
      "INSERT INTO tasks (title, status, created_at, completed_at) VALUES (?, ?, '2026-01-01T00:00:00+00:00', ?)",
    )
    .run(title, opts.status ?? "inbox", opts.completedAt ?? null);
  return Number(r.lastInsertRowid);
}

/** 本地正午的 RFC3339 串（「今日」口径注入——任何时区下 localDate 都归当天） */
function noonToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString().replace("Z", "+00:00");
}

describe("备份域：backupRun / backupList", () => {
  it("backupRun 落盘 VACUUM INTO 快照：命名对齐桌面、可独立打开、含全部数据", async () => {
    seedTask("备份我");

    const { file, files } = data<{ file: string; files: Array<{ file: string }> }>(await caller("backupRun"));
    expect(file).toMatch(/^pokemon-choose-you-\d{8}-\d{6}(-\d+)?\.db$/);
    const path = join(backupDir(join(db.dir, "data")), file);
    expect(existsSync(path)).toBe(true);
    expect(files.map((f) => f.file)).toContain(file);

    // 快照是完整独立库（VACUUM INTO 不含 WAL 垃圾，可直接打开）
    const snap = new DatabaseSync(path);
    expect(snap.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
    snap.close();

    // 源库继续写不影响已落盘快照
    seedTask("后来的");
    const snap2 = new DatabaseSync(path);
    expect(snap2.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
    snap2.close();

    // 同秒连跑第二份也不互相覆盖（序号后缀/跨秒时间戳都产生新文件）
    const again = data<{ file: string }>(await caller("backupRun")).file;
    expect(again).not.toBe(file);
    expect(existsSync(join(backupDir(join(db.dir, "data")), again))).toBe(true);
  });

  it("backup_keep 滚动保留：超量删最旧，无关文件不动（Rust prune 测试同手法）", async () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_keep', '2')").run();
    seedTask("保留目标");

    // 预置两份旧备份 + 一份无关文件，再跑一份今天的：只留最新 2 份
    const dir = backupDir(join(db.dir, "data"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pokemon-choose-you-20260911-080000.db"), "");
    writeFileSync(join(dir, "pokemon-choose-you-20260912-080000.db"), "");
    writeFileSync(join(dir, "notes.txt"), "");

    const fresh = data<{ file: string }>(await caller("backupRun")).file;
    const { backups } = data<{ backups: Array<{ file: string }> }>(await caller("backupList"));
    expect(backups).toHaveLength(2);
    expect(backups.map((b) => b.file)).toEqual([fresh, "pokemon-choose-you-20260912-080000.db"]);
    expect(existsSync(join(dir, "pokemon-choose-you-20260911-080000.db"))).toBe(false);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });

  it("backupList 形状（文件名/大小/RFC3339 时间，倒序）；目录不存在返回空列表", async () => {
    expect(await caller("backupList")).toEqual({ ok: true, data: { backups: [] } });

    seedTask("形状目标");
    await caller("backupRun");
    const { backups } = data<{ backups: Array<{ file: string; size: number; createdAt: string }> }>(
      await caller("backupList"),
    );
    expect(backups).toHaveLength(1);
    expect(backups[0].file).toMatch(/^pokemon-choose-you-\d{8}-\d{6}(-\d+)?\.db$/);
    expect(backups[0].size).toBeGreaterThan(0);
    expect(backups[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe("导出域：exportRun", () => {
  beforeEach(() => {
    seedTask("写周报", { status: "done", completedAt: noonToday() });
    seedTask('交报告, 第二版 "最终"');
    db.conn
      .prepare("INSERT INTO tags (name, description, dimension_id, created_at) VALUES ('重要', '', 1, '2026-09-01')")
      .run();
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (1, 1)").run();
    db.conn
      .prepare(
        "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (1, '对方确认周五交付', 'manual', ?)",
      )
      .run(noonToday());
    db.conn
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('language', 'en'), ('ai_prompt_capture', '我的覆盖'), ('ai_agent_presets_v2', '1')",
      )
      .run();
  });

  it("kind=json：全量表数据 + 信封字段；设置排除提示词覆盖与内部标记", async () => {
    const { path } = data<{ path: string }>(await caller("exportRun", { kind: "json" }));
    expect(path).toMatch(/pokemon-choose-you-full-\d{8}-\d{6}\.json$/);
    expect(path.startsWith(join(exportsDir(join(db.dir, "data"))))).toBe(true);

    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      app: string;
      format: number;
      exportedAt: string;
      data: Record<string, Array<Record<string, unknown>>>;
    };
    expect(parsed.app).toBe("pokemon-choose-you");
    expect(parsed.format).toBe(1);
    expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 表数据带出（全量 11 表键齐 + 任务两行 + 联表关联）
    expect(Object.keys(parsed.data).sort()).toEqual(
      [
        "categories",
        "tasks",
        "tags",
        "task_tags",
        "task_notes",
        "task_logs",
        "chat_messages",
        "feishu_users",
        "sync_state",
        "settings",
        "chat_filter_prefs",
      ].sort(),
    );
    expect(parsed.data.tasks).toHaveLength(2);
    expect(parsed.data.task_tags).toHaveLength(1);
    // 设置行随导出带出，但覆盖键/内部标记不出文件
    expect(parsed.data.settings).toContainEqual(expect.objectContaining({ key: "language", value: "en" }));
    expect(JSON.stringify(parsed.data.settings)).not.toContain("ai_prompt_");
    expect(JSON.stringify(parsed.data.settings)).not.toContain("ai_agent_presets_v2");
  });

  it("kind=csv：BOM + 表头 + RFC4180 转义 + 标签拼接", async () => {
    const { path } = data<{ path: string }>(await caller("exportRun", { kind: "csv" }));
    expect(path).toMatch(/pokemon-choose-you-tasks-\d{8}-\d{6}\.csv$/);
    const csv = readFileSync(path, "utf8");
    expect(csv.startsWith("\u{feff}")).toBe(true);
    expect(csv).toContain(
      "id,title,status,priority,category,tags,due_at,remind_at,focus_seconds,source,created_at,completed_at",
    );
    expect(csv).toContain('"交报告, 第二版 ""最终"""');
    expect(csv).toContain("重要");
    expect(csv.trimEnd().split("\n")).toHaveLength(3);
  });

  it("kind=report：今日日报三段（今日捕捉/路线上/今日跟进），文件名含日期", async () => {
    const today = todayStr(new Date());
    const { path } = data<{ path: string }>(await caller("exportRun", { kind: "report" }));
    expect(path.endsWith(`pokemon-choose-you-daily-${today}.md`)).toBe(true);
    const md = readFileSync(path, "utf8");
    expect(md).toContain(`# 训练家日报 · ${today}`);
    expect(md).toContain("今日捕捉 1 只");
    expect(md).toContain("- ✅ 写周报（工作·皮卡丘 · normal）");
    expect(md).toContain("- [ ] 交报告");
    expect(md).toContain("No.1 写周报：对方确认周五交付");
  });

  it("未知导出类型 → INVALID_ARGUMENT 信封", async () => {
    const bad = (await caller("exportRun", { kind: "xlsx" })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_ARGUMENT");
  });
});
