/**
 * 装配段单测（petSection / loopSection 拆件 + sshExecutor 直连/装配件的分支面）：
 * 伪依赖（fake timer/spawner/记录器）驱动装配函数——细节行为已有各域单测，此处收
 * 装配分支（降级缺省/可选面在位/事件路由），沿 integration.spec 分层替身口径。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAndInit } from "../src/host/storage/init";
import type { Conn } from "../src/host/storage/db";
import { assembleLoopsFull, assemblePollLoops, parityCommandDeps } from "../src/host/loopSection";
import { assemblePet, type PluginSlots } from "../src/host/petSection";
import { PomoStateStore } from "../src/host/pet/pomoState";
import type { PluginDeps } from "../src/host/assembly";
import { HealthState } from "../src/host/health/snapshot";
import { createLark } from "../src/host/radio/lark";

let dir: string;
let conn: Conn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-sections-"));
  conn = openAndInit(join(dir, "data", "test.db")).conn;
});
afterEach(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 空插件依赖面（各可选注入全缺省——降级分支面） */
function baseDeps(over: Partial<PluginDeps> = {}): PluginDeps {
  return {
    pollTimer: () => () => undefined,
    feedTimer: { every: () => 0, cancel: () => undefined },
    autoTimer: { every: () => 1, cancel: () => undefined },
    reminderTimer: () => () => undefined,
    backupTimer: () => () => undefined,
    ...over,
  };
}

type HostLog = (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;

/** 记录器（装配回调断言面） */
function recorder(): { logs: Array<[string, string]>; log: HostLog } {
  const logs: Array<[string, string]> = [];
  return { logs, log: (_l, t, m) => logs.push([t, m]) };
}

describe("assemblePet（桌宠段装配）", () => {
  it("petSpawner 缺省 → supervisor null + stateFeed 仍在位（槽位回填）", () => {
    const slots: PluginSlots = { feed: null, supervisor: null, pomo: new PomoStateStore() };
    const rec = recorder();
    const { supervisor, stateFeed } = assemblePet({
      conn,
      deps: baseDeps(),
      log: rec.log,
      slots,
      openPage: () => undefined,
      health: new HealthState(),
      newExecutor: () => null,
    });
    expect(supervisor).toBeNull();
    expect(stateFeed).not.toBeNull();
    expect(slots.supervisor).toBeNull();
    expect(slots.feed).toBe(stateFeed);
    stateFeed.stop();
  });

  it("petSpawner 在位 → supervisor 装配 + 槽位回填（petVisible 投影 false）", () => {
    const slots: PluginSlots = { feed: null, supervisor: null, pomo: new PomoStateStore() };
    const rec = recorder();
    const { supervisor, stateFeed } = assemblePet({
      conn,
      deps: baseDeps({
        petSpawner: {
          spawn: () => {
            throw new Error("装配期不真实拉起");
          },
        } as never,
      }),
      log: rec.log,
      slots,
      openPage: () => undefined,
      health: new HealthState(),
      newExecutor: () => null,
    });
    expect(supervisor).not.toBeNull();
    expect(slots.supervisor).toBe(supervisor);
    expect(slots.feed).toBe(stateFeed);
    expect(petVisibleOf(slots)).toBe(false); // 未 show = 不在跑
    stateFeed.stop();
  });
});

/** slots 上的 petVisible 投影（supervisor running 面） */
function petVisibleOf(slots: PluginSlots): boolean {
  return slots.supervisor?.running ?? false;
}

describe("assemblePollLoops / assembleLoopsFull（循环段装配）", () => {
  it("轮询 + 自动派发循环装配（timer 全注入），stop 幂等收口", () => {
    const rec = recorder();
    const { poll, auto } = assemblePollLoops({
      conn,
      deps: baseDeps(),
      lark: createLark("lark-cli"),
      health: new HealthState(),
      log: rec.log,
      newExecutor: () => null,
      feed: { notifyLocalWrite: () => undefined },
    });
    expect(poll).toBeDefined();
    expect(auto).toBeDefined();
    poll.stop();
    auto.stop();
  });
});

describe("备份循环（runOnce 跨天/跳过路径）", () => {
  it("数据目录在位 → 首跑 created、同日二跑 already-today（键已写）", () => {
    process.env.CHOOSE_YOU_HOME = dir;
    try {
      conn
        .prepare(
          "INSERT INTO tasks (title, status, created_at) VALUES ('有数据', 'inbox', '2026-01-01T00:00:00+00:00')",
        )
        .run();
      const rec = recorder();
      const { backupLoop, reminder, reminderDelivery } = assembleLoopsFull({
        conn,
        deps: baseDeps(),
        supervisor: null,
        log: rec.log,
        stateFeed: { notifyLocalWrite: () => undefined } as never,
      });
      expect(reminder).toBeDefined();
      expect(reminderDelivery).toBeDefined();
      const outcome = backupLoop.runOnce();
      expect(outcome.created).toBe(true);
      const second = backupLoop.runOnce(); // 同日二跑：already-today 短路（键已写）
      expect(second).toMatchObject({ created: false, reason: "already-today", keyWritten: true });
      backupLoop.stop();
      reminder.stop();
    } finally {
      delete process.env.CHOOSE_YOU_HOME;
    }
  });
});

/** 远程平台面最小 fake（路由判定走 local——零 SSH 触碰） */
function fakeRemotePlatform() {
  return {
    scopeFor: async () => null,
    readHelperArtifact: () => ({ version: "0.1.6", sha256: "x" }),
    sshFamilyAvailable: () => false,
    disconnect: async () => undefined,
  } as never;
}

/** stateFeed 桩（parityCommandDeps 组用） */
const feedStub = {
  notifyLocalWrite: () => undefined,
  announceCaught: () => undefined,
  pushSysConfig: () => undefined,
} as never;

describe("parityCommandDeps（full-parity 可选面组装）", () => {
  it("全部可选面缺省 → dispatchDeps 空对象 + announceCaught/onPetLifecycle 在位", () => {
    const out = parityCommandDeps({ conn, deps: baseDeps(), supervisor: null, stateFeed: feedStub });
    expect(out.dispatchDeps).toEqual({});
    expect(out.petBridge).toBeUndefined();
    expect(out.helperPath).toBeUndefined();
    expect(out.sshFamily).toBeUndefined();
    expect(out.announceCaught).toBeDefined();
    expect(out.onPetLifecycle).toBeDefined();
  });
});

describe("parityCommandDeps：dispatchDeps 合并分支", () => {
  it("既有 dispatchDeps 注入与 remote 合并共存（?? 缺省与 spread 合并两分支）", () => {
    const a = parityCommandDeps({
      conn,
      deps: baseDeps({ dispatchDeps: { marker: 1 } as never }),
      supervisor: null,
      stateFeed: feedStub,
    });
    expect(a.dispatchDeps).toMatchObject({ marker: 1 });
    const remote = fakeRemotePlatform();
    const b = parityCommandDeps({
      conn,
      deps: baseDeps({ dispatchDeps: { marker: 1 } as never, remote }),
      supervisor: null,
      stateFeed: feedStub,
    });
    expect(b.dispatchDeps).toMatchObject({ marker: 1 });
    expect(b.dispatchDeps?.executorFor).toBeDefined();
  });

  it("remote/监督器/helperPath/sshFamily 在位 → 对应键全量接线", () => {
    const remote = fakeRemotePlatform();
    const supervisor = { currentBridge: () => null, running: false } as never;
    const out = parityCommandDeps({
      conn,
      deps: baseDeps({
        remote,
        helperPath: () => "/h/main.js",
        sshFamily: () => ({ ok: true, detail: "", missing: false }),
      }),
      supervisor,
      stateFeed: feedStub,
    });
    expect(out.remote).toBe(remote);
    expect(out.dispatchDeps?.executorFor).toBeDefined();
    expect(out.dispatchDeps?.deploymentPrecheck).toBeDefined();
    expect(out.petBridge).toBeDefined();
    expect(out.helperPath).toBeDefined();
    expect(out.sshFamily).toBeDefined();
  });
});
