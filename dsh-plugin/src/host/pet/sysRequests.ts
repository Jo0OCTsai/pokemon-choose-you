/**
 * seq 两段语义状态机（full-parity AD §4.3 / A28）：dialog-request / mac-auth-query 类
 * 请求的回执级 ack（10s 超时判能力在位）与完成级 result（不设短超时、≥5min 长超时兜底）
 * + cancel 通道（迟到结果丢弃）。由 SysChannel 持有（门控在其上层），BridgeClient 每代
 * helper 一实例——重启换代即重建，pending 清零。
 */
import { PkyError } from "../storage/errors";
import type {
  DialogFileFilter,
  DialogRequestMsg,
  DownstreamMsg,
  MacAuthResultMsg,
} from "../../../helper/src/bridge/protocol";

/** 回执级 ack 超时（AD §4.3：判「能力在位」——不与用户交互时长耦合） */
export const ACK_TIMEOUT_MS = 10_000;
/** 完成级长超时兜底（≥5min；用户在系统对话框停留任意时长不触发降级） */
export const RESULT_TIMEOUT_MS = 300_000;

/** 注入式时钟（测试用手动时钟推进；缺省真 setTimeout） */
export interface SysClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const sysSystemClock: SysClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** 对话框结果（seq 内部化；canceled=true 无 paths） */
export interface DialogOutcome {
  canceled: boolean;
  paths: string[];
}

export type RequestOutcome = DialogOutcome | { granted: boolean };

interface Pending {
  kind: "dialog" | "mac-auth";
  acked: boolean;
  ackTimer: unknown;
  resultTimer: unknown;
  resolve(value: RequestOutcome): void;
  reject(error: Error): void;
}

function capabilityMissing(detail: string): PkyError {
  return new PkyError(
    "HELPER_CAPABILITY_MISSING",
    `helper 系统能力不可用：${detail}`,
    "确认 helper 已运行且为最新版本",
  );
}

export interface SysRequestQueueOptions {
  /** 下行发送出口（输出侧死返回 false） */
  transmit(msg: DownstreamMsg): boolean;
  clock?: SysClock;
  /** 无对应 pending 的 mac-auth-result（seq 0 主动上报，授权撤销/恢复）→ 状态面回调 */
  onMacAuthChange?(msg: MacAuthResultMsg): void;
}

/** 构造期归一后的依赖面（内部持有形态） */
interface QueueDeps {
  transmit(msg: DownstreamMsg): boolean;
  clock: SysClock;
  onMacAuthChange?(msg: MacAuthResultMsg): void;
}

/** seq 请求队列：pending 配对 / 双段计时 / cancel / dispose（迟到的 ack 与 result 丢弃计错） */
export class SysRequestQueue {
  readonly stats = { requests: 0, lateDropped: 0 };

  private nextSeq = 1;
  private pendings = new Map<number, Pending>();
  private readonly opts: QueueDeps;

  constructor(opts: SysRequestQueueOptions) {
    this.opts = { transmit: opts.transmit, clock: opts.clock ?? sysSystemClock, onMacAuthChange: opts.onMacAuthChange };
  }

  get pendingCount(): number {
    return this.pendings.size;
  }

  /** 发起两段请求（门控与 seq 消息组装归调用方；transmit 失败即拒） */
  start(kind: Pending["kind"], build: (seq: number) => DownstreamMsg): Promise<RequestOutcome> {
    this.stats.requests++;
    return new Promise((resolve, reject) => {
      const seq = this.nextSeq++;
      const pending: Pending = { kind, acked: false, ackTimer: null, resultTimer: null, resolve, reject };
      this.pendings.set(seq, pending);
      if (!this.opts.transmit(build(seq))) {
        this.pendings.delete(seq);
        reject(capabilityMissing("helper 通道不可用"));
        return;
      }
      pending.ackTimer = this.opts.clock.setTimeout(() => {
        this.pendings.delete(seq);
        reject(capabilityMissing(`${kind} ack 超时（10s 回执级）`));
      }, ACK_TIMEOUT_MS);
    });
  }

  /** ack 到位：清回执计时、启完成级长计时（不设短超时——用户交互时长不触发降级） */
  onAck(seq: number, kind: Pending["kind"]): void {
    const pending = this.pendings.get(seq);
    if (pending === undefined || pending.kind !== kind || pending.acked) {
      this.stats.lateDropped++;
      return;
    }
    pending.acked = true;
    this.opts.clock.clearTimeout(pending.ackTimer);
    pending.resultTimer = this.opts.clock.setTimeout(() => {
      this.pendings.delete(seq);
      pending.reject(new Error(`${kind} result 长超时（完成级 ≥5min 兜底）`));
    }, RESULT_TIMEOUT_MS);
  }

  /** dialog-result：pending 配对结清；cancel 后迟到 / 未知 seq 丢弃计错 */
  onDialogResult(seq: number, canceled: boolean, paths: string[]): void {
    const pending = this.pendings.get(seq);
    if (pending === undefined || pending.kind !== "dialog") {
      this.stats.lateDropped++;
      return;
    }
    this.settle(seq, { canceled, paths });
  }

  /** mac-auth-result：配对结清；seq 0 = 主动上报（授权撤销/恢复）走状态面回调 */
  onMacAuthResult(msg: MacAuthResultMsg): void {
    const pending = this.pendings.get(msg.seq);
    if (pending === undefined || pending.kind !== "mac-auth") {
      if (msg.seq === 0) {
        this.opts.onMacAuthChange?.(msg);
        return;
      }
      this.stats.lateDropped++;
      return;
    }
    this.settle(msg.seq, { granted: msg.granted });
  }

  /** host 侧取消：以 canceled 收口（cancel 下发由调用方完成）；迟到 result 随之丢弃 */
  cancelDialog(seq: number): boolean {
    if (!this.pendings.has(seq)) return false;
    this.settle(seq, { canceled: true, paths: [] });
    return true;
  }

  /** 通道断开（helper 退出/换代）：pending 全部按能力缺席收口 */
  dispose(): void {
    for (const seq of [...this.pendings.keys()]) {
      const pending = this.pendings.get(seq);
      this.clearTimers(pending);
      this.pendings.delete(seq);
      pending?.reject(capabilityMissing("helper 通道已断开"));
    }
  }

  private settle(seq: number, value: RequestOutcome): void {
    const pending = this.pendings.get(seq);
    if (pending === undefined) return;
    this.clearTimers(pending);
    this.pendings.delete(seq);
    pending.resolve(value);
  }

  private clearTimers(pending: Pending | undefined): void {
    if (pending === undefined) return;
    this.opts.clock.clearTimeout(pending.ackTimer);
    this.opts.clock.clearTimeout(pending.resultTimer);
    pending.ackTimer = null;
    pending.resultTimer = null;
  }
}

/** dialog-request 组装小件（SysChannel 组装面共用） */
export function buildDialogRequest(filters?: DialogFileFilter[]): (seq: number) => DialogRequestMsg {
  return (seq) => ({ type: "dialog-request", mode: "open-file", seq, ...(filters !== undefined ? { filters } : {}) });
}
