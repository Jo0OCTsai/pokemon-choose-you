/**
 * dsh/brokerServe：broker 服务循环 op 分发——connect 一次性 / 未连接拒绝 /
 * 各 op 透传形状 / disconnect 先应答后收线 / 读侧 EOF 尽力 dispose / 分发异常转
 * error 应答。内存双工 + fake scope 全覆盖（进程 API 零依赖面）。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { serveBroker, type BrokerScopeFace } from "../src/host/dsh/brokerServe";
import { encodeHostRequest, type BrokerReply, type HostRequest } from "../src/host/dsh/brokerProtocol";

/** 内存读面：feed 触发 data；end() 触发 end */
class FakeReadable extends EventEmitter {
  feed(chunk: Buffer | string): void {
    this.emit("data", typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  endStream(): void {
    this.emit("end");
  }
}

/** 内存写面：收线后拒写（对齐 stdout.end 行为） */
class FakeWritable {
  written: string[] = [];
  ended = false;
  write(chunk: string): boolean {
    if (this.ended) {
      return false;
    }
    this.written.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
  }
  replies(): BrokerReply[] {
    return this.written.map((line) => JSON.parse(line) as BrokerReply);
  }
}

function rig(scope: BrokerScopeFace | ((config: unknown) => BrokerScopeFace)) {
  const readable = new FakeReadable();
  const writable = new FakeWritable();
  const handle = serveBroker((req) => Promise.resolve(typeof scope === "function" ? scope(req) : scope), {
    readable,
    writable,
  });
  const send = (msg: HostRequest): void => {
    readable.feed(encodeHostRequest(msg));
  };
  return { readable, writable, handle, send };
}

const CONNECT: HostRequest = {
  id: 1,
  op: "connect",
  config: { host: "a", launch: { kind: "node-script", node: "/n" }, helper: "/h", helperHash: "x", workspace: "/w" },
  deploymentId: "dep-1",
  workdir: "/w",
};

function fakeScope(): BrokerScopeFace & { disconnectCalls(): number } {
  const terminals = new Map<string, { writes: string[]; terminated: boolean }>();
  let disconnected = 0;
  let disconnectStarted = false;
  const scope: BrokerScopeFace = {
    async spawn(argv) {
      return { code: 0, stdout: `ran:${argv.join(" ")}`, stderr: "", durationMs: 3 };
    },
    async spawnTerminal() {
      const sessionId = `pky-term-1-${terminals.size + 1}`;
      terminals.set(sessionId, { writes: [], terminated: false });
      return { sessionId };
    },
    async writeTerminal(sessionId, data) {
      const t = terminals.get(sessionId);
      if (t === undefined) return false;
      t.writes.push(data);
      return true;
    },
    async terminateTerminal(sessionId) {
      return terminals.delete(sessionId);
    },
    async disconnect() {
      if (disconnectStarted) return; // 幂等（与 DshSshScope.disconnectStarted 同语义）
      disconnectStarted = true;
      disconnected += 1;
    },
  };
  return Object.assign(scope, { disconnectCalls: () => disconnected });
}

async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 断言位第 i 条应答为 ok 并取其 result（失败即抛——把 ?.ok && 链收敛进助手） */
function okResult(replies: BrokerReply[], i: number): unknown {
  const r = replies[i];
  if (r === undefined || !r.ok) {
    throw new Error(`reply ${String(i)} 不为 ok`);
  }
  return r.result;
}

describe("brokerServe 服务循环", () => {
  it("connect → 各 op 透传（结果语义按 op 还原）", async () => {
    const scope = fakeScope();
    const { writable, handle, send } = rig(scope);
    send(CONNECT);
    send({ id: 2, op: "spawn", argv: ["/bin/echo", "hi"], cwd: "/w" });
    send({ id: 3, op: "spawnTerminal", argv: ["/bin/sh"], cwd: "/w" });
    send({ id: 4, op: "writeTerminal", sessionId: "pky-term-1-1", data: "ls\n" });
    send({ id: 5, op: "writeTerminal", sessionId: "unknown", data: "x" });
    send({ id: 6, op: "terminateTerminal", sessionId: "pky-term-1-1" });
    send({ id: 7, op: "disconnect" });
    await handle.stopped;
    const replies = writable.replies();
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(okResult(replies, 1)).toMatchObject({ code: 0, stdout: "ran:/bin/echo hi" });
    expect(okResult(replies, 2)).toEqual({ sessionId: "pky-term-1-1" });
    expect(okResult(replies, 3)).toEqual({ ok: true });
    expect(okResult(replies, 4)).toEqual({ ok: false }); // 未知会话 → false（非 error）
    expect(okResult(replies, 5)).toEqual({ ok: true });
  });

  it("disconnect：先应答后收线（幂等路径计一次）", async () => {
    const scope = fakeScope();
    const { writable, handle, send } = rig(scope);
    send(CONNECT);
    send({ id: 7, op: "disconnect" });
    await handle.stopped;
    const replies = writable.replies();
    expect(replies[1]?.id).toBe(7);
    expect(replies[1]?.ok).toBe(true); // disconnect 应答在场（先应答后收线）
    expect(scope.disconnectCalls()).toBe(1); // dispatch 一次 + finish 尽力（幂等语义下计一次路径）
    expect(writable.ended).toBe(true);
  });

  it("未连接的非 connect op → error 应答（不崩循环）", async () => {
    const { writable, send } = rig(fakeScope());
    send({ id: 2, op: "spawn", argv: ["/bin/echo"], cwd: "/w" });
    await flush();
    const reply = writable.replies()[0];
    expect(reply?.ok).toBe(false);
    expect(reply && !reply.ok && reply.error).toContain("未连接");
  });
});

describe("brokerServe 连接异常与收线", () => {
  it("重复 connect → error；connect 装配失败 → error 应答（消息透传）", async () => {
    const { writable, send } = rig(() => {
      throw new Error("helper 摘要不符");
    });
    send(CONNECT);
    await flush();
    expect(writable.replies()[0]).toMatchObject({ id: 1, ok: false, error: "helper 摘要不符" });

    const { writable: w2, send: send2 } = rig(fakeScope());
    send2(CONNECT);
    await flush();
    send2({ ...CONNECT, id: 9 });
    await flush();
    const dup = w2.replies()[1];
    expect(dup?.ok).toBe(false);
    expect(dup && !dup.ok && dup.error).toContain("已连接");
  });

  it("读侧 EOF（宿主消亡）→ 尽力 dispose + 收线；后续 op 无效", async () => {
    const { readable, writable, handle, send } = rig(fakeScope());
    send(CONNECT);
    await flush();
    readable.endStream();
    await handle.stopped;
    expect(writable.ended).toBe(true);
  });
});
