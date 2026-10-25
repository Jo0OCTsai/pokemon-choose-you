/**
 * broker 服务循环（bundle 进 dist/broker.mjs，跑在系统 Node 子进程内）：
 * 对 stdio JSON 行请求做 op 分发，转发到注入的 scope 面——真实 scope =
 * brokerMain 里裸 cordis 装配的 DshSshScope（与进程内实现同一类，语义零分叉）。
 * 本模块不触进程 API（读写面经参数注入）——单测用内存流全覆盖。
 *
 * 生命周期：connect 一次性建连（重复 = 拒）；disconnect 应答后收线；
 * 读侧 EOF（宿主消亡）→ 尽力 dispose 退出，不留孤儿连接。请求串行处理
 * （connect 完成前涌入的后续 op 排队不竞态）。
 *
 * 实现拆件（复杂度棘轮 max-lines-per-function，等量迁移）：单请求处理 =
 * handleRequest（模块级件），serveBroker 只做装线与收口。
 */
import {
  createLineDecoder,
  encodeBrokerReply,
  type BrokerConnectConfig,
  type BrokerReply,
  type HostRequest,
} from "./brokerProtocol";

/** broker 侧消费的 scope 面（DshSshScope 超集的最小投影；SshTerminalScope 同形） */
export interface BrokerScopeFace {
  spawn(
    argv: string[],
    opts?: { timeoutMs?: number; stdin?: string },
  ): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>;
  spawnTerminal(opts: { command: string; args?: string[]; cwd?: string }): Promise<{ sessionId: string }>;
  writeTerminal(sessionId: string, data: string): Promise<boolean>;
  terminateTerminal(sessionId: string): Promise<boolean>;
  disconnect(): Promise<void>;
}

/** 读面（process.stdin / 测试内存流同形） */
export interface BrokerIoRead {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** 写面（process.stdout / 测试内存流同形） */
export interface BrokerIoWrite {
  write(chunk: string): boolean;
  end(): void;
}

/** 连接装配缝（brokerMain 提供：裸 cordis 双 label isolate + DshSshScope） */
export type BrokerConnect = (req: {
  config: BrokerConnectConfig;
  deploymentId: string;
  workdir: string;
}) => Promise<BrokerScopeFace>;

/** 服务循环句柄（stopped = disconnect 应答后或读侧 EOF 收线完成） */
export interface BrokerServeHandle {
  stopped: Promise<void>;
}

/** connect 之外的请求面（connect 经装配缝特殊处理） */
export type BrokerOpRequest = Exclude<HostRequest, { op: "connect" }>;

/** 单请求分发（模块级件）：未连接拒绝 + 五原语透传 */
async function dispatchOp(scope: BrokerScopeFace | null, req: BrokerOpRequest): Promise<unknown> {
  if (scope === null) {
    throw new Error("未连接（connect 先行）");
  }
  switch (req.op) {
    case "spawn":
      return await scope.spawn(req.argv, { timeoutMs: req.timeoutMs, stdin: req.stdin });
    case "spawnTerminal":
      return await scope.spawnTerminal(terminalOptsOf(req));
    case "writeTerminal":
      return { ok: await scope.writeTerminal(req.sessionId, req.data) };
    case "terminateTerminal":
      return { ok: await scope.terminateTerminal(req.sessionId) };
    case "disconnect":
      await scope.disconnect();
      return {};
  }
}

/** spawnTerminal 请求 → scope 参数（argv 首元命令/余元参数；cwd 空串缺省登录目录） */
function terminalOptsOf(req: Extract<BrokerOpRequest, { op: "spawnTerminal" }>): {
  command: string;
  args?: string[];
  cwd?: string;
} {
  return {
    command: req.argv[0] ?? "/bin/sh",
    ...(req.argv.length > 1 ? { args: req.argv.slice(1) } : {}),
    ...(req.cwd !== undefined && req.cwd !== "" ? { cwd: req.cwd } : {}),
  };
}

/** 服务态（handleRequest 消费——scope 生命周期与收口单点） */
interface ServeState {
  scope: BrokerScopeFace | null;
  connect: BrokerConnect;
  reply(msg: BrokerReply): void;
  finish(): Promise<void>;
}

/** 单请求处理（串行队列单元）：connect 装配 / op 分发 / disconnect 先应答后收线 */
async function handleRequest(state: ServeState, req: HostRequest): Promise<void> {
  try {
    if (req.op === "connect") {
      if (state.scope !== null) {
        throw new Error("broker 已连接（连接一次性——重复 connect 拒绝）");
      }
      state.scope = await state.connect({
        config: req.config,
        deploymentId: req.deploymentId,
        workdir: req.workdir,
      });
      state.reply({ id: req.id, ok: true, result: {} });
      return;
    }
    const result = await dispatchOp(state.scope, req);
    state.reply({ id: req.id, ok: true, result }); // disconnect 也先应答再收线（finish 后写面关闭）
    if (req.op === "disconnect") {
      await state.finish();
    }
  } catch (error) {
    state.reply({
      id: req.id,
      ok: false,
      error: String(error instanceof Error ? error.message : error).slice(0, 500),
    });
  }
}

/**
 * 服务循环：读侧行解码 → 串行请求队列 → 应答写回。disconnect / 读侧 EOF →
 * dispose 尽力执行后收线（stopped 落定）。
 */
export function serveBroker(
  connect: BrokerConnect,
  io: { readable: BrokerIoRead; writable: BrokerIoWrite },
): BrokerServeHandle {
  let stopped = false;
  let resolveStopped: () => void = () => undefined;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const state: ServeState = {
    scope: null,
    connect,
    reply: (msg) => {
      if (!stopped) {
        io.writable.write(encodeBrokerReply(msg));
      }
    },
    finish: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (state.scope !== null) {
        await Promise.resolve(state.scope.disconnect()).catch(() => undefined); // 宿主消亡收线——尽力
      }
      io.writable.end();
      resolveStopped();
    },
  };

  let queue: Promise<void> = Promise.resolve();
  const decoder = createLineDecoder<HostRequest>((req) => {
    queue = queue.then(() => handleRequest(state, req));
  });
  io.readable.on("data", (chunk) => decoder.feed(chunk));
  io.readable.on("end", () => void state.finish());
  io.readable.on("error", () => void state.finish());
  return { stopped: stoppedPromise };
}
