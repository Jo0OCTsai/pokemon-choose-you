/**
 * pet/cmdHandler：上行 cmd → domain 调用（start/pause/resume/done/switch）+ pos
 * 持久化 + open-page/capture/hide 转发；focus-settle → domain/focus 幂等账本
 * （两次同 localSessionId 只入账一次——D16/A20）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCmd, handleFocusSettle } from "../src/host/pet/cmdHandler";
import { getPetPos } from "../src/host/pet/stateFeed";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("cmd → domain（真实临时 SQLite）", () => {
  it("start/switch：出发任务（顶下 demote 由 domain 原语承载）", () => {
    const t1 = seedTask(db.conn, "任务一");
    const t2 = seedTask(db.conn, "任务二");
    handleCmd({ conn: db.conn }, { type: "cmd", op: "start", taskId: t1 });
    expect(status(t1)).toBe("active");
    // switch 另一任务：原 active 被顶下（全局唯一进行中）
    handleCmd({ conn: db.conn }, { type: "cmd", op: "switch", taskId: t2 });
    expect(status(t2)).toBe("active");
    expect(status(t1)).toBe("scheduled"); // domain 出发原语负责 demote
  });

  it("pause（当前）→ resume（缺省取最近暂停）→ done", () => {
    const t = seedTask(db.conn, "任务", { status: "active", startedAt: "2026-01-15T08:00:00+00:00" });
    handleCmd({ conn: db.conn }, { type: "cmd", op: "pause" });
    expect(status(t)).toBe("paused");
    handleCmd({ conn: db.conn }, { type: "cmd", op: "resume" });
    expect(status(t)).toBe("active");
    handleCmd({ conn: db.conn }, { type: "cmd", op: "done", taskId: t });
    expect(status(t)).toBe("done");
  });

  it("resume 无暂停任务 → no-op 不抛错；capture 无文本转发空串", () => {
    expect(() => handleCmd({ conn: db.conn }, { type: "cmd", op: "resume" })).not.toThrow();
    const seen: string[] = [];
    handleCmd({ conn: db.conn, onCapture: (t) => seen.push(t) }, { type: "cmd", op: "capture" });
    expect(seen).toEqual([""]);
  });

  it("taskId 缺失/非法 → 参数错（start/switch）", () => {
    expect(() => handleCmd({ conn: db.conn }, { type: "cmd", op: "start" })).toThrowError(/taskId/);
    expect(() => handleCmd({ conn: db.conn }, { type: "cmd", op: "switch", taskId: "abc" })).toThrowError(/taskId/);
  });

  it("任意 cmd 携带 pos → 持久化 dsh:pet_pos（拖动上报；petMove 同义）", () => {
    handleCmd({ conn: db.conn }, { type: "cmd", op: "pet-interact", pos: { x: 30, y: 40 } });
    expect(getPetPos(db.conn)).toEqual({ x: 30, y: 40 });
    handleCmd({ conn: db.conn }, { type: "cmd", op: "start", taskId: seedTask(db.conn, "t"), pos: { x: 1, y: 2 } });
    expect(getPetPos(db.conn)).toEqual({ x: 1, y: 2 });
  });
});

describe("cmd 转发面（pos 持久化 / 回关注入）", () => {
  it("capture/hide/open-page/pet-interact → 注册回调转发（零依赖注入面）", () => {
    const seen: string[] = [];
    const deps = {
      conn: db.conn,
      onCapture: (text: string) => seen.push(`capture:${text}`),
      onHide: () => seen.push("hide"),
      onOpenPage: () => seen.push("open-page"),
      onPetInteract: () => seen.push("interact"),
    };
    handleCmd(deps, { type: "cmd", op: "capture", text: "闪电捕一只" });
    handleCmd(deps, { type: "cmd", op: "hide" });
    handleCmd(deps, { type: "cmd", op: "open-page" });
    handleCmd(deps, { type: "cmd", op: "pet-interact" });
    expect(seen).toEqual(["capture:闪电捕一只", "hide", "open-page", "interact"]);
  });

  it("domain 写后 onWrites 直推钩子被调用（装配层接 stateFeed.notifyLocalWrite）", () => {
    let writes = 0;
    handleCmd(
      { conn: db.conn, onWrites: () => writes++ },
      { type: "cmd", op: "start", taskId: seedTask(db.conn, "t") },
    );
    expect(writes).toBe(1);
  });
});

describe("focus-settle → domain/focus（D16 幂等）", () => {
  it("两次同 localSessionId 只入账一次（账本命中跳过）", () => {
    const t = seedTask(db.conn, "专注任务", { status: "active" });
    const r1 = handleFocusSettle(db.conn, { type: "focus-settle", taskId: t, localSessionId: "s-1", elapsedMin: 5 });
    expect(r1.settled).toBe(true);
    expect(r1.focusSeconds).toBe(300);
    const r2 = handleFocusSettle(db.conn, { type: "focus-settle", taskId: t, localSessionId: "s-1", elapsedMin: 5 });
    expect(r2.settled).toBe(false); // 幂等账本命中
    expect(r2.focusSeconds).toBe(300); // 不重复累加
    // 不同 session 正常入账
    const r3 = handleFocusSettle(db.conn, { type: "focus-settle", taskId: t, localSessionId: "s-2", elapsedMin: 3 });
    expect(r3.settled).toBe(true);
    expect(r3.focusSeconds).toBe(480);
  });
});

function status(taskId: number): string {
  return (db.conn.prepare("SELECT status FROM tasks WHERE id=?").get(taskId) as { status: string }).status;
}
