/**
 * 轮询循环装配（D14 分支 A：timer 载体）——行为基准 = src-tauri/src/feishu.rs 的
 * spawn_poll_loop：每轮开头回收超时 judging（A6）→ 读共享设置（开关 + 间隔）→
 * 拉取 → 触发判定 → 健康更新 → 失败退避（×2 封顶 ×8，成功复位）→ 入睡前登记
 * 下次轮询时间。零 dsh 依赖：timer 接口注入（setInterval 语义回调；真实
 * cordis-plugin-timer 由装配层接入）。未授权（LARK_UNAUTHORIZED）暂停拉取并
 * 只发一次事件，直至授权恢复（pollNow 成功或显式 resume）。
 */
import { type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { reclaimStaleJudging } from "../domain/claim";
import { getSetting } from "../domain/settings";
import { judgePending } from "../judge/orchestrator";
import type { JudgeExecutor } from "../judge/adapters";
import { FEISHU, type HealthState } from "../health/snapshot";
import { backoffFactor, pollIntervalSecs } from "./backoff";
import { pullOnce } from "./fetcher";
import type { LarkCli } from "./lark";

/** timer 注入面：setInterval 语义（回调 + 毫秒），返回清除函数 */
export type TimerApi = (cb: () => void, ms: number) => () => void;

/** 真实 timer（Node setInterval 薄封装；装配层可换成 cordis-plugin-timer） */
export const realTimer: TimerApi = (cb, ms) => {
  const handle = setInterval(cb, ms);
  return () => clearInterval(handle);
};

export type PollEvent = "unauthorized";

export interface PollLoopDeps {
  conn: Conn;
  lark: LarkCli;
  health: HealthState;
  /** 每轮判定执行方工厂（返回 null = 未配置 AI agent，判定跳过不阻断拉取） */
  newExecutor: () => JudgeExecutor | null;
  timer?: TimerApi;
  /** 日志出口（host 半边内存环形缓冲）；缺省丢弃 */
  log?: (level: "info" | "warn", message: string) => void;
  /** 未授权单次事件（host→客户端提示的装配层挂点） */
  onEvent?: (event: PollEvent) => void;
  now?: () => number;
}

export interface PollRoundResult {
  ok: boolean;
  inserted: number;
  unauthorized: boolean;
  error?: string;
}

export interface PollLoop {
  /** 单轮（手动 pollNow 共用；暂停中强制执行并按结果恢复/保持暂停） */
  runRound(): Promise<PollRoundResult>;
  /** 启动循环（立即跑一轮再按间隔调度） */
  start(): void;
  stop(): void;
  /** 授权恢复（larkAuth 成功后由装配层调用） */
  resume(): void;
  readonly paused: boolean;
}

function feishuEnabled(conn: Conn): boolean {
  return getSetting(conn, "feishu_enabled") === "true";
}

/** epoch 毫秒 → RFC3339（与库内时间戳同形态） */
function rfc3339(ms: number): string {
  return new Date(ms).toISOString().replace("Z", "+00:00");
}

/** 循环可变状态（未授权暂停 / 单次事件标记） */
interface LoopState {
  deps: PollLoopDeps;
  now: () => number;
  paused: boolean;
  unauthorizedNotified: boolean;
}

/** 一轮的成功路径：拉取 → 触发判定 → 健康记成功 → 清暂停态 */
async function runSuccessPath(state: LoopState): Promise<PollRoundResult> {
  const { deps } = state;
  const pull = await pullOnce(deps.conn, deps.lark, { nowMs: state.now() });
  const executor = deps.newExecutor();
  if (executor !== null && pull.pendingIds.length > 0) {
    await judgePending({ conn: deps.conn, executor, health: deps.health });
  }
  deps.health.recordSuccess(FEISHU, rfc3339(state.now()));
  if (state.paused) {
    deps.log?.("info", "radio: 授权已恢复，轮询继续");
  }
  state.paused = false;
  state.unauthorizedNotified = false;
  deps.log?.("info", `radio: 本轮拉取 ${pull.inserted} 条消息（${pull.pendingIds.length} 条待判定）`);
  return { ok: true, inserted: pull.inserted, unauthorized: false };
}

/** 一轮的失败路径：未授权转暂停（单次事件）、健康记失败、退避由失败计数驱动 */
function runFailurePath(state: LoopState, error: unknown): PollRoundResult {
  const { deps } = state;
  const unauthorized = error instanceof PkyError && error.code === "LARK_UNAUTHORIZED";
  if (unauthorized && !state.unauthorizedNotified) {
    state.unauthorizedNotified = true;
    state.paused = true;
    deps.onEvent?.("unauthorized");
    deps.log?.("warn", "radio: lark-cli 未授权，轮询暂停（授权后自动恢复）");
  }
  const message = error instanceof Error ? error.message : String(error);
  deps.health.recordFailure(FEISHU, message, rfc3339(state.now()));
  deps.log?.("warn", `radio: 轮询失败：${message}`);
  return { ok: false, inserted: 0, unauthorized, error: message };
}

/** 一轮主流程（manual=true 为手动 pollNow：暂停中强制执行并按结果恢复/保持暂停） */
async function runRoundInternal(state: LoopState, manual: boolean): Promise<PollRoundResult> {
  const { deps } = state;
  // 每轮开头回收超时 judging（A6）：claim 后崩溃/被杀的判定 10 分钟后回置 pending
  const reclaimed = reclaimStaleJudging(deps.conn, rfc3339(state.now()));
  if (reclaimed > 0) {
    deps.log?.("info", `radio: 回收 ${reclaimed} 条超时 judging 待重判（A6）`);
  }
  if (!feishuEnabled(deps.conn)) {
    return { ok: true, inserted: 0, unauthorized: false };
  }
  if (state.paused && !manual) {
    return { ok: true, inserted: 0, unauthorized: true };
  }
  try {
    return await runSuccessPath(state);
  } catch (error) {
    return runFailurePath(state, error);
  }
}

/** 创建轮询循环（不自动启动；测试可只驱动 runRound） */
export function createPollLoop(deps: PollLoopDeps): PollLoop {
  const timer = deps.timer ?? realTimer;
  const state: LoopState = { deps, now: deps.now ?? Date.now, paused: false, unauthorizedNotified: false };
  let stopped = false;
  let clearTimer: (() => void) | null = null;

  const loop = {
    get paused() {
      return state.paused;
    },
    async runRound() {
      return runRoundInternal(state, true);
    },
    start() {
      stopped = false;
      void cycle();
    },
    stop() {
      stopped = true;
      clearTimer?.();
      clearTimer = null;
    },
    resume() {
      state.paused = false;
      state.unauthorizedNotified = false;
    },
  };

  const scheduleNext = (): void => {
    if (stopped) {
      return;
    }
    const interval = pollIntervalSecs(deps.conn);
    const failures = deps.health.snapshot(FEISHU).consecutiveFailures;
    const sleepMs = interval * backoffFactor(failures) * 1000;
    deps.health.setNextRun(FEISHU, state.now() + sleepMs);
    clearTimer?.();
    clearTimer = timer(() => void cycle(), sleepMs);
  };

  const cycle = async (): Promise<void> => {
    await runRoundInternal(state, false);
    scheduleNext();
  };

  return loop;
}
