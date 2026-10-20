/**
 * 桥客户端（host 侧）：与 helper 的 stdio JSON 行通道（AD §4.3 协议全集——基础五种下行 +
 * full-parity 系统能力扩展；`sys` 子面 = SysChannel）。
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
  type InputActivityMsg,
  type Lang,
  type MacAuthResultMsg,
  type NotifyClickedMsg,
  type PomodoroConfigMsg,
  type PomoStateMsg,
  type ShortcutFiredMsg,
  type SpritesMsg,
  type SysUnsupportedMsg,
  type TaskStateMsg,
  type TrayActionMsg,
  type UpstreamMsg,
} from "../../../helper/src/bridge/protocol";
import { SysChannel, isSeqUpstream, isSysEventUpstream, type SysClock, type SysEventUpstream } from "./sysChannel";

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

/** 上行处理分发（基础五种 + 系统能力扩展六种；seq 四消息由 sys 通道内部消化） */
export interface BridgeClientHandlers {
  onCmd(msg: CmdMsg): void;
  onFocusSettle(msg: FocusSettleMsg): void;
  /** 番茄相位快照（相位迁移 / hello 后补发；宿主只留最新帧——chip 倒计时数据源） */
  onPomoState?(msg: PomoStateMsg): void;
  onHello?(msg: HelloMsg): void;
  onCrashDiag?(msg: CrashDiagMsg): void;
  /** 托盘菜单动作（quit = 复用 supervisor 停 helper；settings 经 pageOpen 链——A37） */
  onTrayAction?(msg: TrayActionMsg): void;
  /** 全局快捷键触发（capture → pageOpen + 聚焦快捕；注册失败 helper 不发） */
  onShortcutFired?(msg: ShortcutFiredMsg): void;
  /** 通知点击观测留痕（无动作语义） */
  onNotifyClicked?(msg: NotifyClickedMsg): void;
  /** 输入活动强度（仅透传桌宠状态面——不落库不外发，NFR-13） */
  onInputActivity?(msg: InputActivityMsg): void;
  /** 能力位与实现失配上报 → 记诊断 + 面板提示升级 helper（HELPER_CAPABILITY_MISSING 语义） */
  onSysUnsupported?(msg: SysUnsupportedMsg): void;
  /** 无对应请求的 mac-auth-result（seq 0 主动上报：授权撤销/恢复）→ inputResponse 状态面 */
  onMacAuthChange?(msg: MacAuthResultMsg): void;
}

export interface BridgeClientOptions {
  handlers: BridgeClientHandlers;
  heartbeatMs?: number;
  timer?: PetTimerApi;
  /** sys 通道时钟（seq 超时测试注入短值/手动推进） */
  sysClock?: SysClock;
}

/** hello 握手完成的回调注册（supervisor 借此重发状态快照） */
export type ReadyListener = (hello: HelloMsg) => void;

export class BridgeClient {
  readonly stats: BridgeClientStats = { linesIn: 0, badLines: 0, invalidMessages: 0, messagesIn: 0, messagesOut: 0 };
  /** sys 系统能力扩展面（hello 门控发送 + seq 两段语义；随本 client 一代生命周期） */
  readonly sys: SysChannel;

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
    this.sys = new SysChannel({
      transmit: (msg) => this.send(msg),
      hello: () => this.helloSeen,
      clock: opts.sysClock,
      onMacAuthChange: (msg) => this.handlers.onMacAuthChange?.(msg),
    });
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

  /** 与 helper 管道断开（进程退出后；幂等）——sys pending 全部按能力缺席收口 */
  detach(): void {
    this.stopHeartbeat();
    this.sys.dispose();
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
    caught?: TaskStateMsg["caught"],
  ): boolean {
    return this.send({
      type: "task-state",
      activeTask,
      badge,
      ts,
      ...(todayTasks !== undefined ? { todayTasks } : {}),
      ...(caught !== undefined ? { caught } : {}),
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

  /** 上行分发（基础五种直派；seq 四消息进 sys 通道；sys 事件六种派可选处理器） */
  private dispatchUpstream(msg: UpstreamMsg): void {
    if (msg.type === "cmd") {
      this.handlers.onCmd(msg);
      return;
    }
    if (msg.type === "focus-settle") {
      this.handlers.onFocusSettle(msg);
      return;
    }
    if (msg.type === "pomo-state") {
      this.handlers.onPomoState?.(msg);
      return;
    }
    if (msg.type === "hello") {
      this.helloSeen = msg;
      this.handlers.onHello?.(msg);
      for (const cb of this.readyListeners) cb(msg);
      return;
    }
    if (isSeqUpstream(msg)) {
      this.sys.handleUpstream(msg);
      return;
    }
    if (isSysEventUpstream(msg)) {
      this.dispatchSysEvent(msg);
      return;
    }
    this.handlers.onCrashDiag?.(msg as CrashDiagMsg);
  }

  /** sys 事件派发（tray-action / shortcut-fired / notify-clicked / input-activity / sys-unsupported） */
  private dispatchSysEvent(msg: SysEventUpstream): void {
    if (msg.type === "tray-action") {
      this.handlers.onTrayAction?.(msg);
      return;
    }
    if (msg.type === "shortcut-fired") {
      this.handlers.onShortcutFired?.(msg);
      return;
    }
    if (msg.type === "notify-clicked") {
      this.handlers.onNotifyClicked?.(msg);
      return;
    }
    if (msg.type === "input-activity") {
      this.handlers.onInputActivity?.(msg);
      return;
    }
    this.handlers.onSysUnsupported?.(msg);
  }
}
