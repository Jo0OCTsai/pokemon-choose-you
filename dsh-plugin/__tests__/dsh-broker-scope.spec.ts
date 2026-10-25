/**
 * dsh/brokerScope：宿主侧 broker 客户端——connect 握手（stderr 尾部并入错误）/
 * spawn 请求透传（stdin/timeoutMs/cwd 组装）/ 子进程意外退出（拒在途 + 置断开 +
 * onDisconnected）/ disconnect 幂等收口（先礼貌请求后杀）/ 组合原语（shell/
 * writeFile）与进程内实现同源。内存子进程替身（spawnChild 注入）全覆盖。
 */
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { BrokerSshScope, type BrokerChildFactory, type BrokerChildLike } from "../src/host/dsh/brokerScope";
import type { HostRequest } from "../src/host/dsh/brokerProtocol";

/** 内存子进程替身：捕获 host 写入的请求行，测试侧手动回应答/触发退出 */
class FakeBrokerChild {
  requests: HostRequest[] = [];
  stderr = "";
  killed = false;
  stdinEnded = false;
  private readonly stdoutEm = new EventEmitter();
  private readonly em = new EventEmitter();
  readonly stdin = {
    write: (chunk: string) => {
      this.requests.push(JSON.parse(chunk.trim()) as HostRequest);
      return true;
    },
    end: () => {
      this.stdinEnded = true;
    },
  };
  readonly stdout = Object.assign(this.stdoutEm, { setEncoding: () => undefined });
  readonly stderrEm = new EventEmitter();
  reply(id: number, payload: { ok: true; result: unknown } | { ok: false; error: string }): void {
    this.stdoutEm.emit("data", `${JSON.stringify({ id, ...payload })}\n`);
  }
  die(): void {
    this.em.emit("exit", 1, null);
  }
  spawnError(err: Error): void {
    this.em.emit("error", err);
  }
  toChildLike(): BrokerChildLike {
    return {
      stdin: this.stdin,
      stdout: this.stdout as unknown as Readable,
      stderr: Object.assign(this.stderrEm, { setEncoding: () => undefined }) as unknown as Readable,
      on: (event: "exit" | "error", listener: (...args: never[]) => void) =>
        this.em.on(event, listener as (...args: unknown[]) => void),
      kill: () => {
        this.killed = true;
        return true;
      },
    };
  }
}

function rig(overrides: Partial<ConstructorParameters<typeof BrokerSshScope>[0]> = {}) {
  const child = new FakeBrokerChild();
  const disconnected: string[] = [];
  const factory: BrokerChildFactory = () => child.toChildLike();
  const scope = new BrokerSshScope({
    nodeBin: "node",
    brokerJsPath: "/fake/broker.mjs",
    deploymentId: "dep-1",
    config: { host: "a", launch: { kind: "node-script", node: "/n" }, helper: "/h", helperHash: "x", workspace: "/w" },
    workdir: "/w",
    onDisconnected: (id) => disconnected.push(id),
    spawnChild: factory,
    ...overrides,
  });
  return { child, scope, disconnected };
}

/** 握手三拍：触发 start → 应答 connect(id=1) → await 完成 */
async function startOk(r: { child: FakeBrokerChild; scope: BrokerSshScope }): Promise<void> {
  const started = r.scope.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  r.child.reply(1, { ok: true, result: {} });
  await started;
}

const CONFIG_REQ = {
  config: {
    host: "a",
    launch: { kind: "node-script" as const, node: "/n" },
    helper: "/h",
    helperHash: "x",
    workspace: "/w",
  },
  deploymentId: "dep-1",
  workdir: "/w",
};

describe("BrokerSshScope（宿主侧客户端）· 连接生命周期", () => {
  it("start：connect 握手成功 → connected；请求行为带五元组", async () => {
    const { child, scope } = rig();
    const started = scope.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(child.requests[0]).toMatchObject({ id: 1, op: "connect", ...CONFIG_REQ });
    child.reply(1, { ok: true, result: {} });
    await started;
    expect(scope.connected).toBe(true);
  });

  it("connect 失败：error 消息透传 + 不置 connected", async () => {
    const { child, scope } = rig();
    const started = scope.start();
    await new Promise((r) => setTimeout(r, 0));
    child.stderrEm.emit("data", "broker: 系统 Node >= 20 必需（当前 v18）\n");
    child.reply(1, { ok: false, error: "连接建立失败：helper 摘要不符" });
    await expect(started).rejects.toThrow(/helper 摘要不符.*v18/s);
    expect(scope.connected).toBe(false);
  });

  it("子进程意外退出：在途请求被拒 + connected=false + onDisconnected", async () => {
    const { child, scope, disconnected } = rig();
    await startOk({ child, scope });
    const pending = scope.spawn(["/bin/sleep", "10"]);
    await new Promise((r) => setTimeout(r, 0));
    child.die();
    await expect(pending).rejects.toThrow(/broker 子进程退出/);
    expect(scope.connected).toBe(false);
    expect(disconnected).toEqual(["dep-1"]);
    // 断开后新请求直接拒（不静默重连）
    await expect(scope.spawn(["/bin/echo"])).rejects.toThrow(/已断开/);
  });

  it("disconnect：礼貌请求 → 应答后子进程自退；幂等只通知一次", async () => {
    const { child, scope, disconnected } = rig();
    await startOk({ child, scope });
    const first = scope.disconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(child.requests[1]).toMatchObject({ id: 2, op: "disconnect" });
    child.reply(2, { ok: true, result: {} });
    await first;
    await scope.disconnect(); // 幂等
    expect(disconnected).toEqual(["dep-1"]);
    expect(scope.connected).toBe(false);
  });
});

describe("BrokerSshScope（宿主侧客户端）· 派生失败", () => {
  it("派生失败（系统 Node 缺位）：错误带 PATH/PKY_BROKER_NODE 提示", async () => {
    const { scope } = rig({
      spawnChild: () => {
        throw new Error("spawn node ENOENT");
      },
    });
    await expect(scope.start()).rejects.toThrow(/派生失败.*PKY_BROKER_NODE/s);
  });
});

describe("BrokerSshScope（宿主侧客户端）· 请求操作", () => {
  it("spawn：argv/cwd/stdin/timeoutMs 组装 + 结果透传", async () => {
    const { child, scope } = rig();
    await startOk({ child, scope });
    const promise = scope.spawn(["/bin/echo", "hi"], { stdin: "text", timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(child.requests[1]).toEqual({
      id: 2,
      op: "spawn",
      argv: ["/bin/echo", "hi"],
      cwd: "/w",
      timeoutMs: 5000,
      stdin: "text",
    });
    child.reply(2, { ok: true, result: { code: 0, stdout: "hi", stderr: "", durationMs: 2 } });
    await expect(promise).resolves.toMatchObject({ code: 0, stdout: "hi" });
  });

  it("shell 组合：/bin/sh -c 包裹 + 255 兜底（与进程内同源语义）", async () => {
    const { child, scope } = rig();
    await startOk({ child, scope });
    const promise = scope.shell("echo hello");
    await new Promise((r) => setTimeout(r, 0));
    expect(child.requests[1]?.op === "spawn" && child.requests[1].argv).toEqual(["/bin/sh", "-c", "echo hello"]);
    child.reply(2, { ok: true, result: { code: null, stdout: "", stderr: "", durationMs: 1 } });
    await expect(promise).resolves.toMatchObject({ code: 255 });
  });

  it("writeTerminal/terminateTerminal：布尔结果透传（未知会话 = false 非 error）", async () => {
    const { child, scope } = rig();
    await startOk({ child, scope });
    const w = scope.writeTerminal("pky-term-1-1", "ls\n");
    const t = scope.terminateTerminal("pky-term-1-1");
    await new Promise((r) => setTimeout(r, 0));
    child.reply(2, { ok: true, result: { ok: true } });
    child.reply(3, { ok: true, result: { ok: false } });
    expect(await w).toBe(true);
    expect(await t).toBe(false);
  });
});

describe("Node 候选链回退（GUI 宿主 PATH 缺 nvm node 场景）", () => {
  it("首候选零回合消亡 → 换下一候选直至成功；全部失败给合并诊断", async () => {
    // 候选 "node"：起即死（模拟 PATH 无 node / 版本过旧退出）；候选绝对路径：正常工作
    const dead = new FakeBrokerChild();
    const alive = new FakeBrokerChild();
    const scope = new BrokerSshScope({
      nodeCandidates: ["node", "/opt/fake/node"],
      brokerJsPath: "/fake/broker.mjs",
      deploymentId: "dep-1",
      config: CONFIG_REQ.config,
      workdir: "/w",
      onDisconnected: () => undefined,
      spawnChild: (bin) => (bin === "node" ? dead : alive).toChildLike(),
    });
    const started = scope.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dead.requests[0]?.op).toBe("connect");
    dead.die(); // 首候选 ENOENT/版本过旧——零协议回合消亡
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alive.requests[0]?.op).toBe("connect"); // 自动换下一候选
    alive.reply(alive.requests[0]!.id, { ok: true, result: {} }); // id 续号（候选间不重置）
    await started;
    expect(scope.connected).toBe(true);
  });

  it("连接失败（node 可用但远端不可达）不换候选——如实上抛", async () => {
    const child = new FakeBrokerChild();
    let calls = 0;
    const scope = new BrokerSshScope({
      nodeCandidates: ["node", "/opt/fake/node"],
      brokerJsPath: "/fake/broker.mjs",
      deploymentId: "dep-1",
      config: CONFIG_REQ.config,
      workdir: "/w",
      onDisconnected: () => undefined,
      spawnChild: () => {
        calls += 1;
        return child.toChildLike();
      },
    });
    const started = scope.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    child.reply(1, { ok: false, error: "连接建立失败：免密未配置" }); // 协议回合发生过
    await expect(started).rejects.toThrow(/免密未配置/);
    expect(calls).toBe(1); // 不换候选
  });
});

describe("请求超时", () => {
  it("在途请求超时被拒（不悬挂）", async () => {
    vi.useFakeTimers();
    try {
      const { child, scope } = rig();
      const started = scope.start();
      await vi.advanceTimersByTimeAsync(0);
      child.reply(1, { ok: true, result: {} });
      await started;
      const pending = scope.spawn(["/bin/sleep", "10"]);
      const assertion = expect(pending).rejects.toThrow(/超时/);
      await vi.advanceTimersByTimeAsync(330_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
