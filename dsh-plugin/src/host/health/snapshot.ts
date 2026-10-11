/**
 * 健康数据面（AD §3.1 health/）：两条外部链路（feishu / ai）的运行时记录 +
 * 诊断全量快照（§4.1.1 diagnosticsSnapshot 字段集）+ 收音机最小可视四元组（D13）。
 * 行为基准 = src-tauri/src/health.rs（HealthState / level 六态归并 / 300 字符截断）
 * 与 src-tauri/src/commands/diagnostics.rs 的 collect_health（pendingCount / primaryAgent）。
 * 内存态（重启后重新积累）；nextRunAt 为 epoch 毫秒（仅飞书轮询循环维护）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { getSetting, primaryAgent } from "../domain/settings";

export const FEISHU = "feishu";
export const AI = "ai";

export type HealthLevel = "off" | "paused" | "idle" | "ok" | "degraded" | "down";

/** 单链路运行时记录（ProviderHealth 同构） */
export interface ProviderHealth {
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  nextRunAt: number | null;
}

/** 失败错误截断上限（health.rs record_failure 的 300 字符口径） */
const ERROR_BRIEF_CHARS = 300;

function emptyHealth(): ProviderHealth {
  return { lastSuccessAt: null, lastError: null, lastErrorAt: null, consecutiveFailures: 0, nextRunAt: null };
}

/** 集成健康状态（内存态，广播由装配层订阅快照实现——本模块无事件面） */
export class HealthState {
  private readonly map = new Map<string, ProviderHealth>();

  private entry(provider: string): ProviderHealth {
    let h = this.map.get(provider);
    if (h === undefined) {
      h = emptyHealth();
      this.map.set(provider, h);
    }
    return h;
  }

  recordSuccess(provider: string, now = nowRfc3339()): void {
    const h = this.entry(provider);
    h.lastSuccessAt = now;
    h.consecutiveFailures = 0;
  }

  recordFailure(provider: string, error: string, now = nowRfc3339()): void {
    const h = this.entry(provider);
    h.lastError = Array.from(error).slice(0, ERROR_BRIEF_CHARS).join("");
    h.lastErrorAt = now;
    h.consecutiveFailures += 1;
  }

  /** 轮询循环入睡前登记下次预计运行时间（epoch 毫秒；不广播避免刷屏） */
  setNextRun(provider: string, atMs: number): void {
    this.entry(provider).nextRunAt = atMs;
  }

  snapshot(provider: string): ProviderHealth {
    return { ...this.entry(provider) };
  }
}

/**
 * 状态归并六态（health.rs level 同构）：off 未配置 / paused 已配置未启用 /
 * idle 已启用尚未运行 / ok 正常 / degraded 降级（1-2 次连续失败）/ down 故障（≥3 次）。
 */
export function level(configured: boolean, enabled: boolean, ran: boolean, failures: number): HealthLevel {
  if (!configured) {
    return "off";
  }
  if (!enabled) {
    return "paused";
  }
  if (failures === 0) {
    return ran ? "ok" : "idle";
  }
  return failures <= 2 ? "degraded" : "down";
}

/** 诊断页单链路视图（IntegrationHealthInfo 同构，camelCase） */
export interface IntegrationHealthInfo {
  provider: string;
  configured: boolean;
  enabled: boolean;
  status: HealthLevel;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  /** 下次预计轮询（epoch 毫秒），仅飞书 */
  nextPollAt: number | null;
  /** 飞书：收音机待确认建议数（todo / update） */
  pendingCount: number;
  /** AI：收音机分类使用的 agent 名称 */
  primaryAgent: string;
}

/** 收音机里待确认的建议数（todo / update 才算积压；collect_health 同口径） */
export function pendingSuggestionCount(conn: Conn): number {
  const row = conn
    .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE review_status='pending' AND ai_status IN ('todo','update')")
    .get() as { n: number };
  return Number(row.n);
}

/**
 * 诊断快照（host 命令 diagnosticsSnapshot）：两条链路完整字段。
 * feishuConfigured 由装配层探测（lark-cli 可执行存在性——子进程探测不进本模块）；
 * feishu 开关读共享设置 feishu_enabled。
 */
export function diagnosticsSnapshot(
  conn: Conn,
  state: HealthState,
  opts: { feishuConfigured: boolean },
): IntegrationHealthInfo[] {
  const agent = primaryAgent(conn);
  const feishuEnabled = getSetting(conn, "feishu_enabled") === "true";
  const pendingCount = pendingSuggestionCount(conn);
  const out: IntegrationHealthInfo[] = [];
  for (const [provider, configured, enabled] of [
    [FEISHU, opts.feishuConfigured, feishuEnabled],
    [AI, agent !== null, true],
  ] as const) {
    const h = state.snapshot(provider);
    const ran = h.lastSuccessAt !== null || h.lastErrorAt !== null;
    out.push({
      provider,
      configured,
      enabled,
      status: level(configured, enabled, ran, h.consecutiveFailures),
      lastSuccessAt: h.lastSuccessAt,
      lastError: h.lastError,
      lastErrorAt: h.lastErrorAt,
      consecutiveFailures: h.consecutiveFailures,
      nextPollAt: provider === FEISHU ? h.nextRunAt : null,
      pendingCount: provider === FEISHU ? pendingCount : 0,
      primaryAgent: agent?.name ?? "",
    });
  }
  return out;
}

/** 收音机健康卡四元组（D13 最小可视面：上次成功/下次轮询/连续失败/待处理积压） */
export function radioHealth(
  conn: Conn,
  state: HealthState,
): {
  lastSuccessAt: string | null;
  nextPollAt: number | null;
  consecutiveFailures: number;
  pendingCount: number;
} {
  const h = state.snapshot(FEISHU);
  return {
    lastSuccessAt: h.lastSuccessAt,
    nextPollAt: h.nextRunAt,
    consecutiveFailures: h.consecutiveFailures,
    pendingCount: pendingSuggestionCount(conn),
  };
}
