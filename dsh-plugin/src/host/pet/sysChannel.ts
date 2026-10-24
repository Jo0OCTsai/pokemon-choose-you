/**
 * sys 通道（host 侧，full-parity AD §4.3 / A28）：桥系统能力扩展消息的发送面。由
 * BridgeClient 持有（每代 helper 一实例）；seq 两段语义状态机拆在 sysRequests.ts。
 *
 * - **hello 发送门控**：未收到 hello 前禁发任何 sys 消息（能力位快照到达才放行——关闭
 *   「能力位缺失但消息已发」竞态窗口）；能力位缺位不发（按位降级，页内通道归装配层）。
 * - tts 文本按桌面口径（voice.rs）剥 emoji/符号截 120 码点后再发送（ttsText.ts）。
 */
import { PkyError } from "../storage/errors";
import { prepareTtsText } from "./ttsText";
import { SysRequestQueue, buildDialogRequest, type DialogOutcome, type SysClock } from "./sysRequests";
import type {
  DialogAckMsg,
  DialogFileFilter,
  DialogResultMsg,
  DownstreamMsg,
  HelloMsg,
  MacAuthAckMsg,
  MacAuthResultMsg,
  SysCap,
  SysConfigMsg,
  SysNotifyMsg,
  TrayActionMsg,
} from "../../../helper/src/bridge/protocol";
import type {
  InputActivityMsg,
  NotifyClickedMsg,
  ShortcutFiredMsg,
  SysUnsupportedMsg,
  UpstreamMsg,
} from "../../../helper/src/bridge/protocol";

export { sysSystemClock, type DialogOutcome, type SysClock } from "./sysRequests";
export { prepareTtsText } from "./ttsText";

export interface SysChannelStats {
  /** hello 未到 / 能力位缺位被门控的发送次数（诊断观测点） */
  blocked: number;
  /** 发出的 seq 请求总数（dialog-request + mac-auth-query） */
  requests: number;
  /** 迟到/未知 seq 的 result 丢弃数（cancel 后迟到、ack 超时后 ack 到达等） */
  lateDropped: number;
  /** 最近一次门控原因（诊断面；装配层 2.7/2.9 投影） */
  lastBlockedReason: string | null;
}

/** sys-config 分节 → 能力位（缺位分节不携带——按面降级，AD §4.3 sys-config 行） */
const SECTION_CAPS: Partial<Record<keyof Omit<SysConfigMsg, "type">, SysCap>> = {
  tray: "sys-tray",
  shortcuts: "sys-shortcut",
  inputResponse: "input-count",
  tts: "sys-tts",
};

/** 无能力位分节（helper 基础面——陪跑/ChatBox；仅受 hello 门控，不按位剥离） */
const UNCAPPED_SECTIONS: readonly (keyof Omit<SysConfigMsg, "type">)[] = ["pet"];

export interface SysChannelOptions {
  /** 下行发送出口（BridgeClient.send——输出侧死返回 false） */
  transmit(msg: DownstreamMsg): boolean;
  /** hello 快照（null = 未握手——门控依据） */
  hello(): HelloMsg | null;
  clock?: SysClock;
  /** 无对应 pending 的 mac-auth-result（seq 0 主动上报）→ inputResponse 状态面（BridgeClient 注入） */
  onMacAuthChange?(msg: MacAuthResultMsg): void;
}

export class SysChannel {
  private readonly transmit: (msg: DownstreamMsg) => boolean;
  private readonly hello: () => HelloMsg | null;
  private readonly queue: SysRequestQueue;
  private blocked = 0;
  private lastBlockedReason: string | null = null;

  constructor(opts: SysChannelOptions) {
    this.transmit = opts.transmit;
    this.hello = opts.hello;
    this.queue = new SysRequestQueue({
      transmit: opts.transmit,
      clock: opts.clock,
      onMacAuthChange: opts.onMacAuthChange,
    });
  }

  get stats(): SysChannelStats {
    return {
      blocked: this.blocked,
      requests: this.queue.stats.requests,
      lateDropped: this.queue.stats.lateDropped,
      lastBlockedReason: this.lastBlockedReason,
    };
  }

  get pendingCount(): number {
    return this.queue.pendingCount;
  }

  // ---- 发送面（hello 门控 + 能力位缺位不发） ----

  /** sys-config：分节过滤（缺位分节剥离；全部缺位则不发） */
  sendSysConfig(config: Omit<SysConfigMsg, "type">): boolean {
    const kept = this.filterSections(config, SECTION_CAPS);
    if (kept === null) return this.block("sys-config 无能力位在位分节");
    return this.transmit({ type: "sys-config", ...kept });
  }

  sendSysNotify(kind: SysNotifyMsg["kind"], title: string, body: string): boolean {
    return this.sendCapped("sys-notify", { type: "sys-notify", kind, title, body });
  }

  /** tts-speak：文本先按桌面口径剥符号截 120（空文本不发送）；失败 helper 静默 */
  sendTtsSpeak(text: string): boolean {
    const prepared = prepareTtsText(text);
    if (prepared === null) return false;
    return this.sendCapped("sys-tts", { type: "tts-speak", text: prepared });
  }

  sendOpenPath(path: string): boolean {
    return this.sendCapped("sys-open", { type: "open-path", path });
  }

  /** chat-reply 无独立能力位（ChatBox 属 helper 基础面）——仅 hello 门控 */
  sendChatReply(text: string, ok: boolean): boolean {
    if (this.hello() === null) return this.block("hello 未收到（发送门控）");
    return this.transmit({ type: "chat-reply", text, ok });
  }

  // ---- seq 两段语义（状态机在 sysRequests；门控在此） ----

  /** 打开系统文件对话框（导入/恢复选文件）：ack 10s 判能力；result 完成级长超时兜底 */
  requestOpenFileDialog(filters?: DialogFileFilter[]): Promise<DialogOutcome> {
    return this.startGated("dialog", "sys-dialog", buildDialogRequest(filters)) as Promise<DialogOutcome>;
  }

  /** host 侧取消：下发 dialog-cancel，pending 以 canceled 收口；迟到 result 丢弃 */
  cancelDialog(seq: number): boolean {
    if (!this.queue.cancelDialog(seq)) return false;
    return this.transmit({ type: "dialog-cancel", seq });
  }

  /** 查询 macOS 辅助功能授权（回执级 ack + 完成级 result，同型两段） */
  queryMacAuth(): Promise<{ granted: boolean }> {
    return this.startGated("mac-auth", "mac-auth", (seq) => ({
      type: "mac-auth-query",
      kind: "accessibility",
      seq,
    })) as Promise<{
      granted: boolean;
    }>;
  }

  /** 上行四消息接入（BridgeClient.dispatchUpstream 路由） */
  handleUpstream(msg: DialogAckMsg | DialogResultMsg | MacAuthAckMsg | MacAuthResultMsg): void {
    if (msg.type === "dialog-ack") {
      this.queue.onAck(msg.seq, "dialog");
      return;
    }
    if (msg.type === "dialog-result") {
      this.queue.onDialogResult(msg.seq, msg.canceled, msg.paths ?? []);
      return;
    }
    if (msg.type === "mac-auth-ack") {
      this.queue.onAck(msg.seq, "mac-auth");
      return;
    }
    this.queue.onMacAuthResult(msg);
  }

  /** 通道断开（helper 退出/换代）：pending 全部按能力缺席收口 */
  dispose(): void {
    this.queue.dispose();
  }

  // ---- 内部 ----

  private block(reason: string): boolean {
    this.blocked++;
    this.lastBlockedReason = reason;
    return false;
  }

  private sendCapped(cap: SysCap, msg: DownstreamMsg): boolean {
    const caps = this.capsSnapshot();
    if (caps === null) return this.block("hello 未收到（发送门控）");
    if (!caps.includes(cap)) return this.block(`能力位缺位：${cap}`);
    return this.transmit(msg);
  }

  /** 两段请求公共骨架：门控不过 → 能力缺席 reject；过 → 交状态机 */
  private startGated(
    kind: "dialog" | "mac-auth",
    cap: SysCap,
    build: (seq: number) => DownstreamMsg,
  ): Promise<DialogOutcome | { granted: boolean }> {
    const caps = this.capsSnapshot();
    if (caps !== null && caps.includes(cap)) {
      return this.queue.start(kind, build);
    }
    return Promise.reject(
      new PkyError(
        "HELPER_CAPABILITY_MISSING",
        `helper 系统能力不可用：${caps === null ? "hello 未收到（发送门控）" : `能力位缺位：${cap}`}`,
        "确认 helper 已运行且为最新版本",
      ),
    );
  }

  private capsSnapshot(): readonly string[] | null {
    const hello = this.hello();
    return hello === null ? null : hello.caps;
  }

  /** 分节过滤：保留能力位在位的分节（无位分节仅过 hello 门控）；全被剥离返回 null（调用方按门控计） */
  private filterSections(
    config: Omit<SysConfigMsg, "type">,
    capsMap: Partial<Record<keyof Omit<SysConfigMsg, "type">, SysCap>>,
  ): Partial<Omit<SysConfigMsg, "type">> | null {
    const caps = this.capsSnapshot();
    if (caps === null) {
      return null;
    }
    const kept: Partial<Omit<SysConfigMsg, "type">> = {};
    let any = false;
    for (const [key, cap] of Object.entries(capsMap) as Array<[keyof Omit<SysConfigMsg, "type">, SysCap]>) {
      const value = config[key];
      if (value === undefined || !caps.includes(cap)) continue;
      (kept as Record<string, unknown>)[key] = value;
      any = true;
    }
    for (const key of UNCAPPED_SECTIONS) {
      const value = config[key];
      if (value === undefined) continue;
      (kept as Record<string, unknown>)[key] = value;
      any = true;
    }
    return any ? kept : null;
  }
}

// ---- 上行路由守卫（BridgeClient.dispatchUpstream 消费；sys 家族单源在此） ----

/** seq 两段语义四消息（dialog/mac-auth 的 ack 与 result——SysChannel 内部消化） */
const SEQ_UPSTREAM_TYPES = ["dialog-ack", "dialog-result", "mac-auth-ack", "mac-auth-result"];

export function isSeqUpstream(
  msg: UpstreamMsg,
): msg is DialogAckMsg | DialogResultMsg | MacAuthAckMsg | MacAuthResultMsg {
  return (SEQ_UPSTREAM_TYPES as readonly string[]).includes(msg.type);
}

/** sys 事件五消息（派 BridgeClientHandlers 可选处理器） */
export type SysEventUpstream =
  TrayActionMsg | ShortcutFiredMsg | NotifyClickedMsg | InputActivityMsg | SysUnsupportedMsg;

export function isSysEventUpstream(msg: UpstreamMsg): msg is SysEventUpstream {
  return ["tray-action", "shortcut-fired", "notify-clicked", "input-activity", "sys-unsupported"].includes(msg.type);
}
