import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Bridge } from "../src/bridge/bridge.ts";
import type { DownstreamMsg } from "../src/bridge/protocol.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-host.mjs");

interface HostReport {
  got: string;
  op?: string | null;
  taskId?: number | string | null;
  localSessionId?: string | null;
}

interface Rig {
  proc: ReturnType<typeof spawn>;
  bridge: Bridge;
  received: DownstreamMsg[];
  reports: Promise<HostReport[]>;
  hello(): boolean;
  /** 下行到达条件轮询（真子进程异步时序，避免固定 sleep 的脆弱断言） */
  waitFor(cond: () => boolean, timeoutMs?: number): Promise<void>;
}

const procs: ReturnType<typeof spawn>[] = [];

/** 契约台架：spawn fake host + helper 侧 Bridge 接管管道（child.stdout = 下行入口，child.stdin = 上行出口） */
function makeRig(mode?: string, opts: Partial<ConstructorParameters<typeof Bridge>[0]> = {}): Rig {
  const proc = spawn(process.execPath, [FIXTURE, ...(mode ? [mode] : [])], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  procs.push(proc);
  const bridge = new Bridge(opts);
  bridge.attach(proc.stdout!, proc.stdin!);
  bridge.start();
  const received: DownstreamMsg[] = [];
  bridge.onMessage((m) => received.push(m));
  return {
    proc,
    bridge,
    received,
    reports: stderrLines(proc),
    hello: () => bridge.send({ type: "hello", version: "test", caps: [] }),
    waitFor: (cond, timeoutMs = 5_000) => waitForCond(cond, timeoutMs),
  };
}

/** 读 fake host 的 stderr 回显行（测试断言通道） */
function stderrLines(proc: ReturnType<typeof spawn>): Promise<HostReport[]> {
  const lines: HostReport[] = [];
  let buf = "";
  const err = proc.stderr!;
  err.setEncoding("utf8");
  err.on("data", (c: string) => {
    buf += c;
    for (;;) {
      const i = buf.indexOf("\n");
      if (i < 0) break;
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) lines.push(JSON.parse(l) as HostReport);
    }
  });
  return new Promise((resolve) => err.on("end", () => resolve(lines)));
}

afterEach(() => {
  for (const p of procs.splice(0)) {
    if (!p.killed) p.kill();
  }
});

describe("桥契约 · 握手与上行", () => {
  it("握手：hello → 下行全集按序送达且计数正确", async () => {
    const rig = makeRig("handshake");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 5);
    expect(rig.received.map((m) => m.type)).toEqual(["task-state", "pomodoro-config", "lang", "sprites", "heartbeat"]);
    const ts = rig.received[0] as Extract<DownstreamMsg, { type: "task-state" }>;
    expect(ts.activeTask?.title).toBe("写周报");
    expect(ts.todayTasks?.length).toBe(2);
    expect(rig.bridge.stats.messagesIn).toBe(5);
    expect(rig.bridge.stats.badLines).toBe(0);
    expect(rig.bridge.stats.invalidMessages).toBe(0);
  });

  it("握手：fake host 侧也收到 hello（stderr 回显通道）", async () => {
    const rig = makeRig("handshake");
    rig.hello();
    rig.proc.stdin!.end();
    expect(await rig.reports).toContainEqual({
      got: "hello",
      op: null,
      taskId: null,
      localSessionId: null,
    });
  });
});

describe("桥契约 · 上行送达", () => {
  it("上行：cmd（start/pause/switch/hide/open-page）与 focus-settle/crash-diag 真管道送达", async () => {
    const rig = makeRig();
    rig.hello();
    rig.bridge.send({ type: "cmd", op: "start", taskId: 9 });
    rig.bridge.send({ type: "cmd", op: "pause" });
    rig.bridge.send({ type: "cmd", op: "switch", taskId: 12, text: "写周报" });
    rig.bridge.send({ type: "cmd", op: "hide", pos: { x: 100, y: 200 } });
    rig.bridge.send({ type: "cmd", op: "open-page" });
    rig.bridge.send({ type: "focus-settle", taskId: 9, localSessionId: "ls-abc", elapsedMin: 7 });
    rig.bridge.send({ type: "crash-diag", entries: [{ ts: 1, tag: "t", detail: "d" }] });
    rig.proc.stdin!.end();

    const got = await rig.reports;
    expect(got.map((r) => r.got)).toEqual(["hello", "cmd", "cmd", "cmd", "cmd", "cmd", "focus-settle", "crash-diag"]);
    expect(got[1]).toMatchObject({ got: "cmd", op: "start", taskId: 9 });
    expect(got[3]).toMatchObject({ got: "cmd", op: "switch", taskId: 12 });
    expect(got[6]).toMatchObject({ got: "focus-settle", localSessionId: "ls-abc" });
  });
});

describe("桥契约 · 编解码容错", () => {
  it("坏行：坏 JSON 行计错不崩，后续合法消息照常送达", async () => {
    const rig = makeRig("bad");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 1);
    expect(rig.bridge.stats.badLines).toBe(1);
    expect(rig.received.map((m) => m.type)).toEqual(["heartbeat"]);
    expect(rig.bridge.stats.invalidMessages).toBe(0);
  });

  it("半行：JSON 拆两次 write 只解出一条（解码器缓冲）", async () => {
    const rig = makeRig("split");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 2);
    expect(rig.received.filter((m) => m.type === "task-state")).toHaveLength(1);
    const ts = rig.received.find((m) => m.type === "task-state") as Extract<DownstreamMsg, { type: "task-state" }>;
    expect(ts.activeTask).toBeNull();
    expect(rig.received.some((m) => m.type === "heartbeat")).toBe(true);
    expect(rig.bridge.stats.badLines).toBe(0);
  });

  it("粘包：一个 chunk 两条完整消息逐行解出", async () => {
    const rig = makeRig("sticky");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 2);
    expect(rig.received.map((m) => m.type)).toEqual(["heartbeat", "lang"]);
  });

  it("校验丢弃：合法 JSON 但缺字段/未知 type → invalidMessages 计数，heartbeat 照常送达", async () => {
    const rig = makeRig("invalid");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 1);
    expect(rig.bridge.stats.invalidMessages).toBe(2);
    expect(rig.received.map((m) => m.type)).toEqual(["heartbeat"]);
  });
});

describe("桥契约 · 宿主存亡", () => {
  it("心跳超时：宿主静默超阈值（可配短值）→ host-dead(heartbeat-timeout) 单次触发", async () => {
    const rig = makeRig("quiet", { heartbeatTimeoutMs: 400, tickMs: 100 });
    const dead = new Promise<string>((res) => rig.bridge.onHostDead((r) => res(r)));
    expect(await dead).toBe("heartbeat-timeout");
    expect(rig.bridge.hostDead).toBe(true);
  });

  it("stdin 管道守卫：宿主退出（stdin end）→ host-dead(stdin-end)，输出侧不再发送", async () => {
    const rig = makeRig();
    rig.hello();
    await new Promise((r) => setTimeout(r, 150));
    const dead = new Promise<string>((res) => rig.bridge.onHostDead((r) => res(r)));
    rig.proc.stdin!.end();
    expect(await dead).toBe("stdin-end");
    expect(rig.bridge.send({ type: "cmd", op: "hide" })).toBe(false);
  });
});

describe("桥契约 · sys 扩展下行（full-parity AD §4.3 双版本矩阵）", () => {
  it("下行 sys 8 条全集按序送达（校验通过面）", async () => {
    const rig = makeRig("sys");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 9);
    expect(rig.received.map((m) => m.type)).toEqual(SYS_DOWNSTREAM_ORDER);
    expect(rig.bridge.stats.invalidMessages).toBe(0);
    expect(rig.bridge.stats.badLines).toBe(0);
  });

  it("sys 形状不符 → 丢弃计错不崩（4 条拒绝 + heartbeat 照常送达）", async () => {
    const rig = makeRig("sys-bad");
    rig.hello();
    await rig.waitFor(() => rig.received.length >= 1);
    expect(rig.bridge.stats.invalidMessages).toBe(4);
    expect(rig.received.map((m) => m.type)).toEqual(["heartbeat"]);
  });
});

describe("桥契约 · sys 扩展上行", () => {
  it("上行 sys 9 条扩展消息真管道送达 fake host（stderr 回显逐条）", async () => {
    const rig = makeRig();
    rig.hello();
    sendSysUpstreamSet(rig.bridge);
    rig.proc.stdin!.end();
    const got = (await rig.reports).map((r) => r.got);
    expect(got).toEqual(["hello", ...SYS_UPSTREAM_ORDER]);
  });

  it("cmd op 扩展 pet-chat 上行送达（FR-A8 问题上载面）", async () => {
    const rig = makeRig();
    rig.hello();
    rig.bridge.send({ type: "cmd", op: "pet-chat", text: "今天心情如何？" });
    rig.proc.stdin!.end();
    const reports = await rig.reports;
    expect(reports[1]).toMatchObject({ got: "cmd", op: "pet-chat" });
  });
});

/** sys 下行全集送达序（fake-host sys 模式逐条对齐） */
const SYS_DOWNSTREAM_ORDER = [
  "sys-config",
  "sys-notify",
  "tts-speak",
  "dialog-request",
  "dialog-cancel",
  "open-path",
  "mac-auth-query",
  "chat-reply",
  "heartbeat",
] as const;

/** sys 上行扩展回显序（hello 之后逐条） */
const SYS_UPSTREAM_ORDER = [
  "tray-action",
  "shortcut-fired",
  "notify-clicked",
  "dialog-ack",
  "dialog-result",
  "mac-auth-ack",
  "mac-auth-result",
  "input-activity",
  "sys-unsupported",
] as const;

/** 上行 sys 扩展 9 条一次发齐（真管道送达断言的载荷面） */
function sendSysUpstreamSet(bridge: Bridge): void {
  bridge.send({ type: "tray-action", action: "quit" });
  bridge.send({ type: "shortcut-fired", id: "capture" });
  bridge.send({ type: "notify-clicked", kind: "reminder" });
  bridge.send({ type: "dialog-ack", seq: 1 });
  bridge.send({ type: "dialog-result", seq: 1, canceled: false, paths: ["/tmp/a.db"] });
  bridge.send({ type: "mac-auth-ack", seq: 2 });
  bridge.send({ type: "mac-auth-result", seq: 0, kind: "accessibility", granted: false });
  bridge.send({ type: "input-activity", cps: 4.5 });
  bridge.send({ type: "sys-unsupported", unsupported: "sys-notify" });
}

/** 轮询等待条件成立 */
async function waitForCond(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 25));
  }
}
