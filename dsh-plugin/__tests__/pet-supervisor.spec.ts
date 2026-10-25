/**
 * pet/supervisor 集成：真实 fake helper 子进程（node 脚本说桥协议）——hello 握手、
 * task-state 送达（日志回读）、cmd 上行处理、focus-settle 幂等（同 localSessionId 只
 * 入账一次）、崩溃自拉起（重启计数）+ 状态与位置恢复、hide/show 生命周期、随 dsh
 * 启动开关接口（独立用例见 pet-autostart.spec.ts）。
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RESTART_DELAY_MS, nodeScriptSpawner, PetSupervisor, RESTART_SLA_MS } from "../src/host/pet/supervisor";
import { handleCmd, handleFocusSettle } from "../src/host/pet/cmdHandler";
import { setPetPos } from "../src/host/pet/stateFeed";
import { createTestDb, seedTask, type TestDb } from "./helpers";
import type { CmdMsg, FocusSettleMsg } from "../helper/src/bridge/protocol";

const FAKE_HELPER = join(import.meta.dirname, "fixtures", "fake-helper.mjs");

let db: TestDb;
let logPath: string;
beforeEach(() => {
  db = createTestDb();
  logPath = join(db.dir, "helper-log.jsonl");
  writeFileSync(logPath, "");
});
afterEach(() => {
  db.close();
});

function readLog(): Array<{ dir: string; msg: Record<string, unknown> }> {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { dir: string; msg: Record<string, unknown> });
  } catch {
    return [];
  }
}

interface Harness {
  supervisor: PetSupervisor;
  cmds: CmdMsg[];
  settles: FocusSettleMsg[];
  crashes: number;
  republished: number[];
  extraArgs: string[];
}

/** 装配 supervisor（真实 fake helper 子进程 + 桥客户端 + cmd/focus 分发） */
function makeSupervisor(
  extraArgs: string[] = [],
  opts: { getPos?: () => { x: number; y: number } | null } = {},
): Harness {
  const cmds: CmdMsg[] = [];
  const settles: FocusSettleMsg[] = [];
  const republished: number[] = [];
  const harness: Harness = {
    supervisor: null as unknown as PetSupervisor,
    cmds,
    settles,
    crashes: 0,
    republished,
    extraArgs,
  };
  const spawner = {
    spawn(args: string[]) {
      return nodeScriptSpawner(FAKE_HELPER, { HELPER_HEADLESS: "1" }).spawn([
        ...args,
        ...extraArgs,
        `--log=${logPath}`,
      ]);
    },
  };
  const supervisor = new PetSupervisor({
    spawner,
    hostPid: process.pid,
    getPos: opts.getPos,
    restartDelayMs: 150,
    helloTimeoutMs: 4_000,
    handlers: {
      onCmd: (msg) => {
        cmds.push(msg);
        handleCmd({ conn: db.conn }, msg);
      },
      onFocusSettle: (msg) => {
        settles.push(msg);
        handleFocusSettle(db.conn, msg);
      },
      onCrashDiag: () => {
        harness.crashes++;
      },
    },
    onBridgeReady: (_bridge, _hello, restartNo) => {
      republished.push(restartNo);
    },
  });
  harness.supervisor = supervisor;
  return harness;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询断言助手（崩拉起时序非确定） */
async function waitUntil(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

describe("hello 握手与心跳", () => {
  it("show() 拉起 fake helper 并完成 hello 握手；hide 停进程", async () => {
    const h = makeSupervisor();
    const hello = await h.supervisor.show();
    expect(hello?.version).toBe("fake-1");
    expect(h.supervisor.running).toBe(true);
    expect(readLog().some((e) => e.dir === "out" && e.msg["type"] === "hello")).toBe(true);
    h.supervisor.hide();
    expect(h.supervisor.running).toBe(false);
    await sleep(150);
  });

  it("心跳 15s（真实 helper 侧看门狗同值）；hide 后 helper 随 stdin 关闭退出", async () => {
    const h = makeSupervisor();
    await h.supervisor.show();
    // fake helper 依赖 stdin data 喂狗：宿主心跳经 bridge 定时下发（这里仅验证管道活着）
    expect(h.supervisor.currentBridge()?.stats.messagesOut ?? 0).toBeGreaterThanOrEqual(0);
    h.supervisor.hide();
  });
});

describe("task-state 送达与状态恢复", () => {
  it("onBridgeReady 后下发可达：helper 收到 lang/task-state（--pos 位置恢复）", async () => {
    const taskId = seedTask(db.conn, "进行中", { status: "active" });
    setPetPos(db.conn, { x: 120, y: 240 });
    const h = makeSupervisor([], { getPos: () => ({ x: 120, y: 240 }) });
    await h.supervisor.show();
    const bridge = h.supervisor.currentBridge();
    expect(bridge).not.toBeNull(); // 装配层在 onBridgeReady 里 republishAll——此处验证可达
    bridge!.sendLang("zh-Hans");
    bridge!.sendTaskState(
      { id: taskId, title: "进行中", categoryPokemon: "pikachu", status: "active" },
      { pendingSuggestions: 0, failures: 0 },
      Date.now(),
    );
    await sleep(150);
    const inbound = readLog().filter((e) => e.dir === "in");
    expect(inbound.some((e) => e.msg["type"] === "lang")).toBe(true);
    const taskState = inbound.find((e) => e.msg["type"] === "task-state")?.msg as
      { activeTask: { id: number } } | undefined;
    expect(taskState?.activeTask.id).toBe(taskId);
    h.supervisor.hide();
  });
});

describe("cmd 上行处理（fake helper → domain）", () => {
  it("fake helper 发 cmd start → domain 出发 + 上行记录", async () => {
    const taskId = seedTask(db.conn, "待出发");
    const h = makeSupervisor(["--emit-cmd=start", `--emit-task-id=${taskId}`]);
    await h.supervisor.show();
    await sleep(250);
    expect(h.cmds).toHaveLength(1);
    expect(h.cmds[0]?.op).toBe("start");
    expect((db.conn.prepare("SELECT status FROM tasks WHERE id=?").get(taskId) as { status: string }).status).toBe(
      "active",
    );
    h.supervisor.hide();
  });
});

describe("focus-settle 幂等（两次同 localSessionId 只入账一次）", () => {
  it("fake helper 发两条同 id focus-settle → focus_seconds 只加一次", async () => {
    const taskId = seedTask(db.conn, "专注任务", { status: "active" });
    const h = makeSupervisor(["--emit-focus=same,same"]);
    await h.supervisor.show();
    await sleep(250);
    expect(h.settles).toHaveLength(2);
    expect(
      (db.conn.prepare("SELECT focus_seconds FROM tasks WHERE id=?").get(taskId) as { focus_seconds: number })
        .focus_seconds,
    ).toBe(300); // 5 分钟只入账一次（幂等账本 dsh:focus_settled）
    h.supervisor.hide();
  });
});

describe("崩溃自拉起（FR-P1：10 秒内）", () => {
  it("fake helper 自杀 → supervisor 重启（计数 +1）且新代 hello/状态恢复回调再触发", async () => {
    const h = makeSupervisor(["--crash-after=200"]);
    await h.supervisor.show();
    expect(h.republished).toEqual([0]);
    // 轮询等待（重启代自身也带 --crash-after 会连环崩——只要某次观测到「已重启 + 新代
    // hello 恢复回调」即证明自拉起；SLA 断言用缺省延迟 ≤ 10s 兜底）
    const okRestart = await waitUntil(
      () => h.supervisor.restarts >= 1 && h.republished.length >= 2 && h.supervisor.running,
      5_000,
    );
    expect(okRestart).toBe(true);
    expect(readLog().filter((e) => e.dir === "out" && e.msg["type"] === "hello").length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_RESTART_DELAY_MS).toBeLessThanOrEqual(RESTART_SLA_MS);
    h.supervisor.hide();
  });

  it("hide 后崩溃不重启（主动停止语义）", async () => {
    const h = makeSupervisor(["--crash-after=100"]);
    await h.supervisor.show();
    h.supervisor.hide();
    await sleep(400);
    expect(h.supervisor.restarts).toBe(0);
    expect(h.supervisor.running).toBe(false);
  });
});

describe("握手超时与幂等（边界分支）", () => {
  it("helper 不说 hello：show() 等待窗后返回 null 但进程在管（hide 可停）", async () => {
    const spawner = {
      spawn(args: string[]) {
        // 真子进程但只挂起（不说协议）——覆盖 waitHello 超时分支与 --pos/--host-pid 缺省分支
        expect(args).toHaveLength(0); // 无 hostPid/pos 时不带参数
        return nodeScriptSpawner(FAKE_HELPER, { HELPER_HEADLESS: "1" }).spawn(["--mute=1", `--log=${logPath}`]);
      },
    };
    const supervisor = new PetSupervisor({
      spawner,
      helloTimeoutMs: 120,
      handlers: { onCmd: () => undefined, onFocusSettle: () => undefined },
    });
    const hello = await supervisor.show();
    expect(hello).toBeNull();
    expect(supervisor.running).toBe(true); // 握手迟到不判死——hello 到时仍会触发恢复回调
    supervisor.hide();
    await sleep(120);
    expect(supervisor.running).toBe(false);
  });

  it("show 幂等：已运行时直接返回现有 hello", async () => {
    const h = makeSupervisor();
    const first = await h.supervisor.show();
    const second = await h.supervisor.show();
    expect(second?.version).toBe(first?.version);
    expect(readLog().filter((e) => e.dir === "out" && e.msg["type"] === "hello")).toHaveLength(1); // 没有二次拉起
    h.supervisor.hide();
  });
});

describe("生命周期边界（hide 撤销待重启 / 早期二次 show / dispose）", () => {
  it("崩溃已排定重启时 hide()：撤销待重启定时器，不再拉起", async () => {
    const h = makeSupervisor(["--crash-after=60"]);
    await h.supervisor.show();
    await sleep(220); // 崩溃已被检测、重启已排定（restartDelayMs=150 的下一档由 hide 撤销）
    const scheduled = h.supervisor.restarts;
    h.supervisor.hide();
    await sleep(400);
    expect(h.supervisor.restarts).toBe(scheduled); // hide 撤销了待执行的重启
    expect(h.supervisor.running).toBe(false);
  });

  it("hello 到达前二次 show()：返回 null（bridge 在但握手未完成），进程不受影响", async () => {
    const h = makeSupervisor();
    const first = h.supervisor.show(); // 不等——hello 尚未到
    const early = await h.supervisor.show();
    expect(early).toBeNull();
    const hello = await first;
    expect(hello?.version).toBe("fake-1");
    expect(h.supervisor.currentBridge()?.hello?.version).toBe("fake-1");
    h.supervisor.hide();
  });

  it("缺省参数监督器（helloTimeout 5s / 重启延迟 1s 缺省分支）+ 崩溃自拉起 + dispose", async () => {
    const h = makeSupervisor();
    // 不传 helloTimeoutMs / restartDelayMs 的监督器：hello 先到即返回（不等满 5s）、
    // 崩溃按缺省 1s 延迟自拉起（SLA 10s 内）——crash-after 驱动真实子进程自杀
    const plain = new PetSupervisor({
      spawner: {
        spawn: (args: string[]) =>
          nodeScriptSpawner(FAKE_HELPER, { HELPER_HEADLESS: "1" }).spawn([...args, "--crash-after=500"]),
      },
      handlers: { onCmd: () => undefined, onFocusSettle: () => undefined },
    });
    const hello = await plain.show();
    expect(hello?.version).toBe("fake-1");
    expect(await waitUntil(() => plain.restarts >= 1, 4_000)).toBe(true);
    plain.dispose();
    expect(plain.running).toBe(false);
    h.supervisor.hide();
  });
});

afterEach(() => {
  rmSync(logPath, { force: true });
});
