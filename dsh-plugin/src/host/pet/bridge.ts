/**
 * 桥客户端（host 侧）：与 helper 的 stdio JSON 行通道（AD §4.3 协议全集）。
 *
 * 类型对齐方式：**直接 import helper 子包的 protocol.ts**（workspace 内相对路径，
 * 零依赖纯 TS 单源——pet 侧与 helper 的对接单源，不做对等复制防漂移）。
 * 与 helper/src/bridge/bridge.ts 的 Bridge 互为对端：helper 校验下行、host 校验上行，
 * 丢弃 + 计错的容错立场两侧一致（坏消息不崩任何一侧）。
 * 心跳 15 秒（AD §4.3 管道守卫；helper 静默超时自杀的供给侧）。
 */
import {
  encodeLine,
  validateUpstream,
  type Badge,
  type CmdMsg,
  type CrashDiagMsg,
  type DownstreamMsg,
  type FocusSettleMsg,
  type HelloMsg,
  type Lang,
  type PomodoroConfigMsg,
  type SpritesMsg,
  type TaskStateMsg,
  type UpstreamMsg,
} from "../../../helper/src/bridge/protocol";

/** 心跳间隔（毫秒，AD §4.3——helper 看门狗超时 15s 的同值供给侧） */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** 注入式定时器（与 dispatch/autoDispatch 同型；pet 侧独立声明避免跨 feature 依赖） */
export interface PetTimerApi {
  every(ms: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
}

export const petSystemTimer: PetTimerApi = {
  every: (ms, fn) => setInterval(fn, ms),
  cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface BridgeClientStats {
  /** 收到的完整行数 */
  linesIn: number;
  /** JSON 解析失败/空行数 */
  badLines: number;
  /** 合法 JSON 但未通过上行校验（未知 type/缺字段）数 */
  invalidMessages: number;
  /** 成功送达的上行消息数 */
  messagesIn: number;
  /** 发出的下行消息数 */
  messagesOut: number;
}

/** 上行处理分发（cmd / focus-settle / hello / crash-diag 全集） */
export interface BridgeClientHandlers {
  onCmd(msg: CmdMsg): void;
  onFocusSettle(msg: FocusSettleMsg): void;
  onHello?(msg: HelloMsg): void;
  onCrashDiag?(msg: CrashDiagMsg): void;
}

export interface BridgeClientOptions {
  handlers: BridgeClientHandlers;
  heartbeatMs?: number;
  timer?: PetTimerApi;
}

/** hello 握手完成的回调注册（supervisor 借此重发状态快照） */
export type ReadyListener = (hello: HelloMsg) => void;

export class BridgeClient {
  readonly stats: BridgeClientStats = { linesIn: 0, badLines: 0, invalidMessages: 0, messagesIn: 0, messagesOut: 0 };

  private buffer = "";
  private output: NodeJS.WritableStream | null = null;
  private heartbeatTimer: unknown = null;
  private readonly heartbeatMs: number;
  private readonly timer: PetTimerApi;
  private readonly handlers: BridgeClientHandlers;
  private readyListeners = new Set<ReadyListener>();
  private helloSeen: HelloMsg | null = null;

  constructor(opts: BridgeClientOptions) {
    this.handlers = opts.handlers;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    this.timer = opts.timer ?? petSystemTimer;
  }

  /** 接上 helper 子进程管道（supervisor spawn 后调用） */
  attach(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
    this.output = output;
    input.on("data", (chunk: string | Buffer) => {
      this.buffer += String(chunk);
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        this.handleLine(line);
      }
    });
  }

  /** 与 helper 管道断开（进程退出后；幂等） */
  detach(): void {
    this.stopHeartbeat();
    this.output = null;
    this.buffer = "";
  }

  /** 启动心跳（attach 后调用；管道守卫的供给侧） */
  startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }
    this.heartbeatTimer = this.timer.every(this.heartbeatMs, () => {
      this.sendHeartbeat();
    });
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      this.timer.cancel(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** hello 握手完成（一次性事件；重启后新 client 实例再触发） */
  onReady(cb: ReadyListener): () => void {
    this.readyListeners.add(cb);
    return () => this.readyListeners.delete(cb);
  }

  get hello(): HelloMsg | null {
    return this.helloSeen;
  }

  // ---- 下行全集（AD §4.3 五种） ----

  send(msg: DownstreamMsg): boolean {
    const out = this.output;
    if (out === null || (out as { destroyed?: boolean }).destroyed === true) {
      return false;
    }
    out.write(encodeLine(msg));
    this.stats.messagesOut++;
    return true;
  }

  sendTaskState(
    activeTask: TaskStateMsg["activeTask"],
    badge: Badge,
    ts: number,
    todayTasks?: TaskStateMsg["todayTasks"],
  ): boolean {
    return this.send({
      type: "task-state",
      activeTask,
      badge,
      ts,
      ...(todayTasks !== undefined ? { todayTasks } : {}),
    });
  }

  sendPomodoroConfig(config: Omit<PomodoroConfigMsg, "type">): boolean {
    return this.send({ type: "pomodoro-config", ...config });
  }

  sendLang(lang: Lang): boolean {
    return this.send({ type: "lang", lang });
  }

  sendSprites(sprites: Omit<SpritesMsg, "type">): boolean {
    return this.send({ type: "sprites", ...sprites });
  }

  sendHeartbeat(ts = Date.now()): boolean {
    return this.send({ type: "heartbeat", ts });
  }

  // ---- 上行解码与分发 ----

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "") {
      return; // 行尾切割产生的空行不计坏行
    }
    this.stats.linesIn++;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      this.stats.badLines++;
      return;
    }
    const msg: UpstreamMsg | null = validateUpstream(value);
    if (msg === null) {
      this.stats.invalidMessages++;
      return;
    }
    this.stats.messagesIn++;
    this.dispatchUpstream(msg);
  }

  /** 上行分发（cmd / focus-settle / hello / crash-diag 全集；hello 触发 ready） */
  private dispatchUpstream(msg: UpstreamMsg): void {
    if (msg.type === "cmd") {
      this.handlers.onCmd(msg);
      return;
    }
    if (msg.type === "focus-settle") {
      this.handlers.onFocusSettle(msg);
      return;
    }
    if (msg.type === "hello") {
      this.helloSeen = msg;
      this.handlers.onHello?.(msg);
      for (const cb of this.readyListeners) cb(msg);
      return;
    }
    this.handlers.onCrashDiag?.(msg);
  }
}
