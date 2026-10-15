/**
 * host 命令装配面（续，从 commands.spec 等量迁出）：复盘向导标签体检域 + 实体读域 +
 * 备份/导出域的信封 happy path。临时库/deps 装配/种子便捷件 → commandsSetup。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandsFixture, seedTask, type CommandsFixture } from "./commandsSetup";

let f: CommandsFixture;

beforeEach(() => {
  f = createCommandsFixture();
});

afterEach(() => {
  f.close();
});

describe("host 命令装配面 · 复盘向导标签体检域", () => {
  it("tagCheckup 报告只读 + tagMerge/tagMoveDimension 信封 ok 与 onWrites（细节见 tag-health.spec）", async () => {
    expect(await f.call("tagUpsert", { name: "周报", dimension: "topic" })).toMatchObject({ ok: true });
    expect(await f.call("tagUpsert", { name: "工作周报", dimension: "topic" })).toMatchObject({ ok: true });
    const tagIds = (f.conn.prepare("SELECT id FROM tags ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    const before = f.writes();
    expect(await f.call("tagCheckup", {})).toMatchObject({ ok: true, data: { judged: false, newDimensions: [] } });
    expect(f.writes()).toBe(before); // 只读命令不触发 onWrites
    expect(await f.call("tagMerge", { fromId: tagIds[1], intoId: tagIds[0] })).toMatchObject({
      ok: true,
      data: { ok: true },
    });
    expect(await f.call("tagMoveDimension", { tagIds: [tagIds[0]], key: "energy", name: "精力" })).toMatchObject({
      ok: true,
      data: { ok: true },
    });
    expect(f.writes()).toBeGreaterThan(before);
  });
});

describe("host 命令装配面 · 实体读域", () => {
  it("5 命令信封 ok（细节形状断言见 readCommands.spec）", async () => {
    seedTask(f.conn, "实体读目标");
    expect(await f.call("panelSnapshot", {})).toMatchObject({
      ok: true,
      data: { adventure: { active: [], dueToday: [], overdue: [] }, radio: { health: expect.any(Object) } },
    });
    expect(await f.call("taskDetail", { taskId: 1 })).toMatchObject({ ok: true, data: { task: { id: 1 } } });
    expect(await f.call("taskSearch", { query: "实体" })).toMatchObject({ ok: true, data: { tasks: [{ id: 1 }] } });
    expect(await f.call("todayTasks", {})).toMatchObject({ ok: true, data: { tasks: expect.any(Array) } });
    expect(await f.call("categoriesList", {})).toMatchObject({ ok: true, data: { categories: expect.any(Array) } });
  });
});

describe("host 命令装配面 · 备份/导出域", () => {
  it("backupRun/backupList/exportRun 三种 kind 信封 ok（产物落盘细节见 backup-export.spec）", async () => {
    // 数据目录经 CHOOSE_YOU_HOME 注入临时根（默认会落用户真实 home——测试须显式指向）
    const prevHome = process.env.CHOOSE_YOU_HOME;
    process.env.CHOOSE_YOU_HOME = f.dir;
    try {
      seedTask(f.conn, "备份目标");
      const backup = (await f.call("backupRun")) as { ok: boolean; data: { file: string; files: unknown[] } };
      expect(backup.ok).toBe(true);
      expect(backup.data.file).toMatch(/^pokemon-choose-you-\d{8}-\d{6}(-\d+)?\.db$/);
      expect(backup.data.files).toEqual(expect.any(Array));
      expect(await f.call("backupList")).toMatchObject({ ok: true, data: { backups: expect.any(Array) } });
      expect(await f.call("exportRun", { kind: "json" })).toMatchObject({
        ok: true,
        data: { path: expect.stringContaining("pokemon-choose-you-full-") },
      });
      expect(await f.call("exportRun", { kind: "csv" })).toMatchObject({
        ok: true,
        data: { path: expect.stringContaining("pokemon-choose-you-tasks-") },
      });
      expect(await f.call("exportRun", { kind: "report" })).toMatchObject({
        ok: true,
        data: { path: expect.stringContaining("pokemon-choose-you-daily-") },
      });
    } finally {
      if (prevHome === undefined) {
        delete process.env.CHOOSE_YOU_HOME;
      } else {
        process.env.CHOOSE_YOU_HOME = prevHome;
      }
    }
  });
});
