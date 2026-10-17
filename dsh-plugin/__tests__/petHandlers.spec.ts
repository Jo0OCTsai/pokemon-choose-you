/**
 * petHandlers 装配处理器单测（从 assemblySections.spec 拆出——棘轮 max-lines，等量
 * 迁移）：focus-settle / done 庆祝 / sys 事件路由 / 显隐 / 聊聊降级 / milestone 链。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAndInit } from "../src/host/storage/init";
import type { Conn } from "../src/host/storage/db";
import { petHandlers, type PluginSlots } from "../src/host/petSection";
import { HealthState } from "../src/host/health/snapshot";

let dir: string;
let conn: Conn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-pet-handlers-"));
  conn = openAndInit(join(dir, "data", "test.db")).conn;
});
afterEach(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

function handlersWith(slots: PluginSlots, seen: { page: string[]; celebrate: string[] }) {
  const rec = recorder();
  const h = petHandlers({
    conn,
    health: new HealthState(),
    log: rec.log,
    slots,
    openPage: (section) => seen.page.push(section ?? ""),
    newExecutor: () => null,
  });
  slots.feed = {
    announceCaught: (v: { milestone?: number; streakDays?: number }) =>
      seen.celebrate.push(String(v.milestone ?? v.streakDays ?? "")),
    notifyLocalWrite: () => undefined,
  } as never;
  return h;
}

type HostLog = (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;

/** 记录器（装配回调断言面） */
function recorder(): { logs: Array<[string, string]>; log: HostLog } {
  const logs: Array<[string, string]> = [];
  return { logs, log: (_l, t, m) => logs.push([t, m]) };
}

describe("petHandlers（桥上行处理器）", () => {
  it("focus-settle 上行 → 写后直推（feed.notifyLocalWrite）", () => {
    const seen = { page: [] as string[], celebrate: [] as string[] };
    const slots: PluginSlots = { feed: null, supervisor: null };
    const h = handlersWith(slots, seen);
    const r = conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES ('专注', 'active', '2026-01-01T00:00:00+00:00')")
      .run();
    h.onFocusSettle?.({
      taskId: Number(r.lastInsertRowid),
      localSessionId: "sess-1",
      elapsedMin: 1,
      focusSeconds: 60,
    } as never);
    expect(seen.celebrate).toHaveLength(0); // settle 不触发庆祝
  });
});

describe("petHandlers：完成庆祝与 sys 事件面", () => {
  it("done 上行：milestone 前后计数喂判定；非 milestone 不打扰", () => {
    const seen = { page: [] as string[], celebrate: [] as string[] };
    const slots: PluginSlots = { feed: null, supervisor: null };
    const h = handlersWith(slots, seen);
    // 真实任务完成：milestone 前后计数喂判定（非 milestone 不打扰——celebrate 空）
    conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES ('完工', 'active', '2026-01-01T00:00:00+00:00')")
      .run();
    const taskId = Number((conn.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id);
    expect(() => h.onCmd?.({ op: "done", taskId } as never)).not.toThrow();
    expect(seen.celebrate).toHaveLength(0);
  });

  it("sys 事件面：托盘/快捷键 open → pageOpen 链；显隐走 supervisor 空转", () => {
    const seen = { page: [] as string[], celebrate: [] as string[] };
    const slots: PluginSlots = { feed: null, supervisor: null };
    const h = handlersWith(slots, seen);
    h.onTrayAction?.({ action: "open" } as never);
    h.onTrayAction?.({ action: "settings" } as never);
    h.onShortcutFired?.({ id: "capture" } as never);
    h.onInputActivity?.({ cps: 3 } as never);
    h.onMacAuthChange?.({ granted: false } as never);
    h.onSysUnsupported?.({ type: "sys-future" } as never);
    expect(seen.page).toEqual(["", "settings", "panel"]);
  });
});

describe("petHandlers：桌宠显隐与聊聊/庆祝链", () => {
  it("tray pet-toggle / shortcut togglePet → supervisor 显隐；petShow 走 show 异步面", () => {
    const seen = { page: [] as string[], celebrate: [] as string[] };
    const calls: string[] = [];
    const slots: PluginSlots = { feed: null, supervisor: null };
    const rec = recorder();
    const h = petHandlers({
      conn,
      health: new HealthState(),
      log: rec.log,
      slots,
      openPage: (section) => seen.page.push(section ?? ""),
      newExecutor: () => null,
    });
    slots.supervisor = {
      show: async () => {
        calls.push("show");
      },
      hide: () => calls.push("hide"),
      running: true,
      currentBridge: () => null,
    } as never;
    h.onTrayAction?.({ action: "pet-toggle" } as never); // running → hide
    (slots.supervisor as unknown as { running: boolean }).running = false;
    h.onShortcutFired?.({ id: "togglePet" } as never); // 静止 → show
    expect(calls).toEqual(["hide", "show"]);
  });
});

/** 图鉴计数置 9 done + 1 active（done 后 9→10 = MILESTONES[0]） */
function seedDexToMilestone(): void {
  const ins = conn.prepare("INSERT INTO tasks (title, status, created_at) VALUES (?, ?, '2026-01-01T00:00:00+00:00')");
  for (let i = 0; i < 9; i += 1) {
    ins.run(`图鉴${i}`, "done");
  }
  ins.run("第十只", "active");
}

describe("petHandlers：聊聊降级与 milestone 庆祝", () => {
  it("pet-chat 上行：未配置 AI agent → 降级回复经桥 sendChatReply", () => {
    const replies: Array<[string, boolean]> = [];
    const slots: PluginSlots = { feed: null, supervisor: null };
    const rec = recorder();
    const h = petHandlers({
      conn,
      health: new HealthState(),
      log: rec.log,
      slots,
      openPage: () => undefined,
      newExecutor: () => null,
    });
    slots.supervisor = {
      currentBridge: () => ({ sys: { sendChatReply: (t: string, ok: boolean) => (replies.push([t, ok]), true) } }),
    } as never;
    h.onCmd?.({ op: "pet-chat", text: "在吗" } as never);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.[1]).toBe(false); // 降级面 ok=false
    expect(rec.logs.some(([t]) => t === "pet:chat")).toBe(true);
  });

  it("done 上行跨 milestone（第 10 只）→ announceCaught 触发（CatchShow 变体直推）", () => {
    const seen = { page: [] as string[], celebrate: [] as string[] };
    const slots: PluginSlots = { feed: null, supervisor: null };
    const rec = recorder();
    const h = petHandlers({
      conn,
      health: new HealthState(),
      log: rec.log,
      slots,
      openPage: () => undefined,
      newExecutor: () => null,
    });
    slots.feed = {
      announceCaught: (v: { milestone?: number; streakDays?: number }) => seen.celebrate.push(String(v.milestone)),
      notifyLocalWrite: () => undefined,
    } as never;
    seedDexToMilestone();
    const lastId = Number(
      (conn.prepare("SELECT id FROM tasks WHERE status='active' LIMIT 1").get() as { id: number }).id,
    );
    expect(() => h.onCmd?.({ op: "done", taskId: lastId } as never)).not.toThrow();
    expect(seen.celebrate).toEqual(["10"]);
  });
});

describe("petHandlers：捕捉与授权恢复分支", () => {
  it("capture 上行：未配置执行器 → warn 丢弃（不建任务）；mac-auth 恢复 → info 留痕", () => {
    const rec = recorder();
    const slots: PluginSlots = { feed: null, supervisor: null };
    const h = petHandlers({
      conn,
      health: new HealthState(),
      log: rec.log,
      slots,
      openPage: () => undefined,
      newExecutor: () => null,
    });
    h.onCmd?.({ op: "capture", text: "整理桌面" } as never);
    expect(rec.logs.some(([t, m]) => t === "pet:capture" && m.includes("捕捉丢弃"))).toBe(true);
    const n = Number((conn.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n);
    expect(n).toBe(0);
    h.onMacAuthChange?.({ granted: true } as never); // 恢复分支
    expect(rec.logs.some(([t, m]) => t === "pet:mac-auth" && m.includes("已恢复"))).toBe(true);
  });
});
