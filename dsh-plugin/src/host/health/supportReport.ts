/**
 * 支持报告组装（host 命令 supportReport）——行为基准 =
 * src-tauri/src/commands/diagnostics.rs 的 build_support_report：版本 + 平台 +
 * 集成健康快照 + 最近 200 条日志，全文过三层脱敏（NFR-2 ⑥）。
 * 报告文本仅返回前端复制到剪贴板，不经任何上传通道（遥测=0）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { diagnosticsSnapshot, FEISHU, type HealthState, type IntegrationHealthInfo } from "./snapshot";
import { type LogRing } from "./logRing";
import { redactLine, redactWithNames, collectSensitiveNames } from "./redact";

/** 报告携带的日志条数（build_support_report 的 200 条口径） */
export const REPORT_LOG_LINES = 200;

export interface SupportReportMeta {
  /** 插件版本（package.json version） */
  pluginVersion: string;
  /** dsh 宿主版本占位（装配层探测注入；未知传 null） */
  dshVersion?: string | null;
  /** 平台（缺省 process.platform） */
  platform?: string;
}

/** 健康段单链路行（collect_health 输出的报告渲染） */
function healthLine(h: IntegrationHealthInfo): string {
  let line = `[${h.provider}] 状态 ${h.status} · 上次成功 ${h.lastSuccessAt ?? "—"} · 连续失败 ${h.consecutiveFailures}`;
  if (h.provider === FEISHU && h.pendingCount > 0) {
    line += ` · 待确认建议 ${h.pendingCount}`;
  }
  if (h.primaryAgent !== "") {
    line += ` · Agent「${h.primaryAgent}」`;
  }
  return line;
}

/** 日志段条目行：时间/目标过键名层，message 过三层全管线 */
function logLine(names: string[], e: { time: string; level: string; target: string; message: string }): string {
  return `${redactLine(e.time)}[${e.level}][${redactLine(e.target)}] ${redactWithNames(names, e.message)}`;
}

/**
 * 生成支持报告文本：插件版本 + dsh 版本占位 + 平台 + 集成健康 + 最近 200 条日志。
 * 健康错误与日志 message 均经三层脱敏——密钥零泄漏（测试断言）。
 */
export function buildSupportReport(
  conn: Conn,
  state: HealthState,
  ring: LogRing,
  meta: SupportReportMeta,
  opts: { now?: string; feishuConfigured?: boolean } = {},
): string {
  const now = opts.now ?? nowRfc3339();
  const infos = diagnosticsSnapshot(conn, state, { feishuConfigured: opts.feishuConfigured ?? false });
  const names = collectSensitiveNames(conn);
  const platform = meta.platform ?? process.platform;
  const dshPart = meta.dshVersion ? ` · dsh：${meta.dshVersion}` : "";
  const lines: string[] = [
    "就决定是你了 支持报告",
    `版本：${meta.pluginVersion}${dshPart} · 平台：${platform} · 生成时间：${now}`,
    "",
    "—— 集成健康 ——",
  ];
  for (const h of infos) {
    lines.push(healthLine(h));
    if (h.lastError !== null) {
      lines.push(`  最近错误：${redactWithNames(names, h.lastError)}`);
    }
  }
  lines.push("", "—— 最近日志（已脱敏：敏感键值 / 邮箱凭证 / 人名群名） ——");
  // 环形缓冲取最近 200 条（query 已是最新在上；报告按时间正序呈现，与文件 tail 阅读序一致）
  const tail = ring.query({ limit: REPORT_LOG_LINES }).entries.slice().reverse();
  if (tail.length === 0) {
    lines.push("（无日志）");
  }
  for (const e of tail) {
    lines.push(logLine(names, e));
  }
  return lines.join("\n") + "\n";
}
