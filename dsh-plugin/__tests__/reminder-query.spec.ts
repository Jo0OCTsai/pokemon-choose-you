/**
 * reminder/query：混排时间解析（RFC3339 / datetime-local / 垃圾输入）、到期粗筛+精判
 * （四态状态集、reminded=0、混排格式、提前量）、reminded CAS（单连接重抢让位、
 * 双连接同窗全系统仅一次）、设置快照缺省与覆盖。行为基准 = 桌面 scheduler.rs 同名
 * 纯函数（contracts/fixtures/reminder 锁定）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, scalar, type TestDb } from "./helpers";
import { setSetting } from "../src/host/domain/settings";
import {
  claimReminded,
  duePrecise,
  formatRfc3339Utc,
  isUrgent,
  loadReminderSettings,
  parseNaiveLocal,
  parseRfc3339,
  parseTimeIn,
  queryDueRows,
  type DueRow,
  type Reminder,
} from "../src/host/reminder/query";

// ---- 混排时间解析（parse_time 系） ----

describe("parseTimeIn 混排解析", () => {
  const TZ8 = 8 * 60;

  it("RFC3339：UTC 与带偏移都直转 UTC", () => {
    expect(parseRfc3339("2026-09-12T08:30:00Z")?.epochMs).toBe(Date.UTC(2026, 8, 12, 8, 30));
    expect(parseRfc3339("2026-09-12T16:30:00+08:00")?.epochMs).toBe(Date.UTC(2026, 8, 12, 8, 30));
    expect(parseRfc3339("2026-09-12T16:30:00+08:00")?.offsetMinutes).toBe(480);
  });

  it("datetime-local：按 tz 解析（无秒 / 带秒两档），RFC3339 分支不受 tz 影响", () => {
    const expectUtc = Date.UTC(2026, 8, 12, 8, 0);
    expect(parseNaiveLocal("2026-09-12T16:00", TZ8)).toBe(expectUtc);
    expect(parseNaiveLocal("2026-09-12T16:00:00", TZ8)).toBe(expectUtc);
    expect(parseTimeIn(TZ8, "2026-09-12T16:00")).toBe(expectUtc);
    expect(parseTimeIn(0, "2026-09-12T08:00")).toBe(expectUtc);
    expect(parseTimeIn(TZ8, "2026-09-12T08:00:00Z")).toBe(expectUtc);
  });

  it("垃圾输入与真实不存在的日期拒绝（chrono 严格性镜像）", () => {
    expect(parseTimeIn(TZ8, "")).toBeNull();
    expect(parseTimeIn(TZ8, "not a time")).toBeNull();
    expect(parseTimeIn(TZ8, "2026-13-45T99:99")).toBeNull();
    expect(parseTimeIn(TZ8, "2026-09-12")).toBeNull(); // 纯日期：两分支都不收
    expect(parseTimeIn(TZ8, "2026-02-30T10:00")).toBeNull(); // 日期不存在
    expect(parseRfc3339("2026-09-12T22:00:00+99:00")).toBeNull(); // 偏移越界
  });

  it("formatRfc3339Utc 产出桌面 to_rfc3339 同形态（+00:00 无小数位）", () => {
    expect(formatRfc3339Utc(Date.UTC(2026, 8, 12, 15, 30))).toBe("2026-09-12T15:30:00+00:00");
  });
});

// ---- 设置快照 ----

describe("loadReminderSettings（缺省与覆盖——桌面 from_conn 同口径）", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });

  it("全键缺省 = 0 / true / true / 22:00 / 08:00 / zh-Hans", () => {
    expect(loadReminderSettings(db.conn)).toEqual({
      leadMinutes: 0,
      notifyOn: true,
      quietOn: true,
      quietStart: "22:00",
      quietEnd: "08:00",
      lang: "zh-Hans",
    });
  });

  it("覆盖读齐：提前量非整数折 0、开关按 'false' 字面判定", () => {
    setSetting(db.conn, "remind_ahead_minutes", "30");
    setSetting(db.conn, "notifications_enabled", "false");
    setSetting(db.conn, "quiet_hours_enabled", "0"); // 非 'false' 字面 → 仍开
    setSetting(db.conn, "quiet_start", "23:30");
    setSetting(db.conn, "quiet_end", "07:00");
    setSetting(db.conn, "language", "en");
    const s = loadReminderSettings(db.conn);
    expect(s.leadMinutes).toBe(30);
    expect(s.notifyOn).toBe(false);
    expect(s.quietOn).toBe(true);
    expect([s.quietStart, s.quietEnd, s.lang]).toEqual(["23:30", "07:00", "en"]);
    setSetting(db.conn, "remind_ahead_minutes", "abc");
    expect(loadReminderSettings(db.conn).leadMinutes).toBe(0);
  });
});

// ---- 到期粗筛 + 精判 ----

function row(id: number, title: string, remindAt: string): DueRow {
  return { id, title, priority: "normal", remindAt, pokemon: null };
}

describe("duePrecise 精判（混排 + 边界含）", () => {
  const TZ8 = 8 * 60;
  const now = Date.UTC(2026, 8, 12, 15, 30);

  it("带偏移 / UTC / 本地无秒 / 恰好到期（含）都算；未来与解析失败跳过", () => {
    const rows = [
      row(1, "带偏移", "2026-09-12T22:00:00+08:00"), // = 14:00Z
      row(2, "utc", "2026-09-12T14:30:00Z"),
      row(3, "本地无秒", "2026-09-12T23:00"), // datetime-local（+08）= 15:00Z
      row(4, "恰好到期", "2026-09-12T15:30:00Z"), // == now → 边界含
      row(5, "未来", "2026-09-12T15:30:01Z"),
      row(6, "解析失败", "2026-09-12"), // 过 SQL 粗筛但解析失败 → 跳过
    ];
    expect(duePrecise(TZ8, rows, now).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

/** 落一条带提醒的任务行（reminder-query 组夹具） */
function insertTaskRow(conn: TestDb["conn"], title: string, status: string, remindAt: string, reminded = 0): number {
  const r = conn
    .prepare(
      "INSERT INTO tasks (title, status, remind_at, reminded, created_at) VALUES (?, ?, ?, ?, '2026-09-01T00:00:00Z')",
    )
    .run(title, status, remindAt, reminded);
  return Number(r.lastInsertRowid);
}

describe("queryDueRows 粗筛 + claimReminded CAS（真实临时库）", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });
  const insertTask = (title: string, status: string, remindAt: string, reminded = 0) =>
    insertTaskRow(db.conn, title, status, remindAt, reminded);

  it("粗筛：四态状态集收、done/cancelled/reminded=1/未来窗口外不收", () => {
    const past = "2026-09-12T14:00:00Z";
    insertTask("草丛", "inbox", past);
    insertTask("路线", "scheduled", past);
    insertTask("进行中", "active", past);
    insertTask("暂停", "paused", past);
    insertTask("已完成", "done", past);
    insertTask("已逃走", "cancelled", past);
    insertTask("已提醒", "scheduled", past, 1);
    insertTask("窗口外", "scheduled", "2026-09-20T14:00:00Z");
    // 行序 = 引擎自然计划（idx_tasks_status 扫描 → status 字典序、同态按 rowid）——
    // 双实现同引擎同序，契约夹具 due:[2,1,3,4]（due-mixed-formats）锁定该序
    const rows = queryDueRows(db.conn, "2026-09-13T15:30:00+00:00");
    expect(rows.map((r) => r.title)).toEqual(["进行中", "草丛", "暂停", "路线"]);
    // category_id 缺省 1（工作/皮卡丘）——LEFT JOIN 带出分类宝可梦名
    expect(rows[1]).toMatchObject({ title: "草丛", remindAt: past, pokemon: "皮卡丘" });
  });
});

describe("claimReminded CAS（真实临时库）", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });
  const insertTask = (title: string, status: string, remindAt: string, reminded = 0) =>
    insertTaskRow(db.conn, title, status, remindAt, reminded);

  it("claimReminded：抢到的置 reminded=1 并保持入参顺序返回；同连接重抢让位", () => {
    const a = insertTask("a", "scheduled", "2026-09-12T14:00:00Z");
    const b = insertTask("b", "scheduled", "2026-09-12T14:10:00Z");
    const due: Reminder[] = [
      { id: a, title: "a", priority: "normal", pokemon: null },
      { id: b, title: "b", priority: "urgent", pokemon: "皮卡丘" },
    ];
    const won = claimReminded(db.conn, due);
    expect(won.map((r) => r.id)).toEqual([a, b]);
    expect(scalar(db.conn, "SELECT reminded FROM tasks WHERE id=?", a)).toBe(1);
    expect(claimReminded(db.conn, due)).toEqual([]); // 同窗重抢全让位
  });

  it("双连接同窗竞争：全系统只有一个 affected=1（D28 仲裁）", () => {
    const id = insertTask("双发竞态", "scheduled", "2026-09-12T14:00:00Z");
    const other = db.secondConn();
    const due: Reminder[] = [{ id, title: "双发竞态", priority: "normal", pokemon: null }];
    const won1 = claimReminded(db.conn, due);
    const won2 = claimReminded(other, due);
    expect(won1.length + won2.length).toBe(1);
    expect(scalar(other, "SELECT reminded FROM tasks WHERE id=?", id)).toBe(1);
  });

  it("claimReminded 对不存在的 id：affected=0 让位不抛错", () => {
    const due: Reminder[] = [{ id: 99999, title: "幽灵", priority: "normal", pokemon: null }];
    expect(claimReminded(db.conn, due)).toEqual([]);
  });

  it("isUrgent：urgent/high 两档为紧急", () => {
    expect(isUrgent("urgent")).toBe(true);
    expect(isUrgent("high")).toBe(true);
    expect(isUrgent("normal")).toBe(false);
    expect(isUrgent("low")).toBe(false);
  });
});
