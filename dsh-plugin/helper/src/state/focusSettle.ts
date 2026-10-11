/**
 * focus-settle 纯逻辑（D16/PROTOCOL §7）：番茄为本地态，任务离开「进行中」时把已专注部分按
 * 整分钟（向下取整）上报 focus-settle；宿主按 localSessionId 幂等入账。短休息取消（不入账）。
 */
import type { ActiveTask, FocusSettleMsg } from "../bridge/protocol.ts";

/** 一次进行中驻留的专注累计（仅 status=active 的时间计入；paused 挂起不累计） */
export interface FocusSession {
  taskId: number | string;
  localSessionId: string;
  /** 已专注毫秒（active 段累加） */
  focusMs: number;
}

export type FocusClock = {
  now: () => number;
  uuid: () => string;
};

/** 「驻留中」= 任务仍在 activeTask 槽位（active 或 paused） */
function inResidency(task: ActiveTask | null): boolean {
  return !!task && (task.status === "active" || task.status === "paused");
}

/** 同一任务继续驻留（未离开、未切换） */
function sameResidency(prev: ActiveTask | null, next: ActiveTask | null): boolean {
  return inResidency(prev) && inResidency(next) && next!.id === prev!.id;
}

/** 会话结账：整分钟（向下取整）可上报，不足 1 分钟丢弃 */
function settleOf(session: FocusSession): Omit<FocusSettleMsg, "type"> | null {
  const elapsedMin = Math.floor(session.focusMs / 60_000);
  return elapsedMin >= 1 ? { taskId: session.taskId, localSessionId: session.localSessionId, elapsedMin } : null;
}

/**
 * active 段累计器：进入 working 时 resume，离开 working（paused/任务离开）时 pause 落账。
 * 纯注入时钟，测试可虚拟推进。
 */
export class FocusAccumulator {
  private session: FocusSession | null = null;
  /** active 段起点（null = 未在计；不能用 0 当哨兵——注入时钟可以从 0 起步） */
  private lastActiveAt: number | null = null;
  private readonly clock: FocusClock;

  // 显式字段赋值（不用参数属性——Node 24 原生类型擦除不支持参数属性语法）
  constructor(clock: FocusClock) {
    this.clock = clock;
  }

  /** task-state 到达时的状态机驱动：返回需上报的 focus-settle（不足 1 分钟为 null） */
  onTaskState(
    prev: ActiveTask | null,
    next: ActiveTask | null,
  ): { settle: Omit<FocusSettleMsg, "type"> | null; session: FocusSession | null } {
    this.pauseAccumulation();
    if (sameResidency(prev, next)) {
      if (next!.status === "active") this.resumeAccumulation();
      return { settle: null, session: this.session };
    }
    const settle = this.closeSession();
    if (inResidency(next)) this.startSession(next!);
    return { settle, session: this.session };
  }

  /** 主动收口（helper 退出前 best-effort 上报） */
  settleNow(): Omit<FocusSettleMsg, "type"> | null {
    this.pauseAccumulation();
    return this.closeSession();
  }

  get current(): FocusSession | null {
    return this.session;
  }

  private closeSession(): Omit<FocusSettleMsg, "type"> | null {
    const settle = this.session ? settleOf(this.session) : null;
    this.session = null;
    return settle;
  }

  private startSession(task: ActiveTask): void {
    this.session = { taskId: task.id, localSessionId: this.clock.uuid(), focusMs: 0 };
    if (task.status === "active") this.resumeAccumulation();
  }

  private resumeAccumulation(): void {
    if (this.session) this.lastActiveAt = this.clock.now();
  }

  private pauseAccumulation(): void {
    if (this.session && this.lastActiveAt !== null) {
      this.session.focusMs += Math.max(0, this.clock.now() - this.lastActiveAt);
      this.lastActiveAt = null;
    }
  }
}
