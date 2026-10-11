/**
 * 桥（AD §3.3/§4.3）：helper 主进程 ↔ 插件宿主半边的 stdio JSON 行通道。
 *
 * 纯 Node 可测（不依赖 Electron）：attach 到任意 duplex（生产 = process.stdin/stdout，
 * 契约测试 = 子进程管道）。职责边界——
 * - 编解码：LineDecoder 半行缓冲 + JSON 行解析（protocol.ts）；
 * - 校验容错：未知 type/缺字段 → 丢弃 + 计错 + 进诊断环形缓冲，绝不抛错崩进程；
 * - 宿主存亡：stdin end/error 直判死；任意数据喂 LivenessWatchdog，静默 > timeoutMs（默认 15s）
 *   判死；--host-pid 轮询双保险（main.ts 装配）。
 */
import { DiagRing } from "./diag.ts";
import { LivenessWatchdog, type HostDeathReason } from "./heartbeat.ts";
import { LineDecoder } from "./lineCodec.ts";
import { encodeLine, parseLine, validateDownstream, type DownstreamMsg, type UpstreamMsg } from "./protocol.ts";

export { HostPidWatchdog, type HostDeathReason } from "./heartbeat.ts";

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

export interface BridgeStats {
  /** 收到的完整行数 */
  linesIn: number;
  /** JSON 解析失败/空行（坏行）数 */
  badLines: number;
  /** 行是合法 JSON 但未通过下行校验（未知 type/缺字段/类型不符）数 */
  invalidMessages: number;
  /** 成功送达的下行消息数 */
  messagesIn: number;
  /** 发出的上行消息数 */
  messagesOut: number;
}

export type DownstreamHandler = (msg: DownstreamMsg) => void;
export type HostDeadHandler = (reason: HostDeathReason) => void;

export interface BridgeOptions {
  /** 宿主静默判死阈值（默认 15s；契约测试注入短值） */
  heartbeatTimeoutMs?: number;
  now?: () => number;
  /** 看门狗巡检间隔（默认 min(timeout/4, 1s)；测试注入短值） */
  tickMs?: number;
}

export class Bridge {
  readonly stats: BridgeStats = {
    linesIn: 0,
    badLines: 0,
    invalidMessages: 0,
    messagesIn: 0,
    messagesOut: 0,
  };
  readonly diag = new DiagRing();

  private decoder = new LineDecoder();
  private watchdog: LivenessWatchdog;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private output: NodeJS.WritableStream | null = null;
  private downstreamHandlers = new Set<DownstreamHandler>();
  private hostDeadHandlers = new Set<HostDeadHandler>();
  private hostDeadEmitted = false;
  private readonly now: () => number;
  private tickMs: number;

  constructor(opts: BridgeOptions = {}) {
    const timeout = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
    this.watchdog = new LivenessWatchdog(timeout, this.now);
    this.tickMs = opts.tickMs ?? Math.min(Math.ceil(timeout / 4), 1_000);
  }

  /** 接上宿主管道（生产：process.stdin / process.stdout） */
  attach(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
    this.output = output;
    input.on("data", (chunk: string | Buffer) => {
      this.watchdog.feed(this.now());
      for (const line of this.decoder.push(chunk)) this.handleLine(line);
    });
    input.on("end", () => this.emitHostDead("stdin-end"));
    input.on("error", () => this.emitHostDead("stdin-error"));
    input.on("close", () => {
      // end 已处理过则幂等；只处理「未收到 end 的管道撕裂」
      if (!this.hostDeadEmitted) this.emitHostDead("stdin-end");
    });
  }

  /** 启动静默看门狗（attach 后调用） */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      if (this.watchdog.isDead(this.now())) this.emitHostDead("heartbeat-timeout");
    }, this.tickMs);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  onMessage(cb: DownstreamHandler): () => void {
    this.downstreamHandlers.add(cb);
    return () => this.downstreamHandlers.delete(cb);
  }

  onHostDead(cb: HostDeadHandler): () => void {
    this.hostDeadHandlers.add(cb);
    return () => this.hostDeadHandlers.delete(cb);
  }

  /** 发上行消息（输出侧已死时返回 false，静默丢弃——宿主不在了没有可送达对象） */
  send(msg: UpstreamMsg): boolean {
    const out = this.output;
    if (!out || this.hostDeadEmitted) return false;
    if ((out as { destroyed?: boolean }).destroyed === true) return false;
    out.write(encodeLine(msg));
    this.stats.messagesOut++;
    return true;
  }

  private handleLine(line: string): void {
    this.stats.linesIn++;
    const parsed = parseLine(line);
    if (!parsed.ok) {
      this.stats.badLines++;
      this.diag.push("bad-line", `${parsed.reason}: ${line.slice(0, 200)}`);
      return;
    }
    const msg = validateDownstream(parsed.value);
    if (!msg) {
      this.stats.invalidMessages++;
      this.diag.push("invalid-msg", line.slice(0, 200));
      return;
    }
    this.stats.messagesIn++;
    for (const cb of this.downstreamHandlers) cb(msg);
  }

  private emitHostDead(reason: HostDeathReason): void {
    if (this.hostDeadEmitted) return;
    this.hostDeadEmitted = true;
    this.stop();
    this.diag.push("host-dead", reason);
    for (const cb of this.hostDeadHandlers) cb(reason);
  }

  /** 宿主是否已判死（main.ts 据此走退出流程） */
  get hostDead(): boolean {
    return this.hostDeadEmitted;
  }
}
