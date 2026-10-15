/**
 * 客户端视图模型（从 rpcTypes 拆出以控文件规模——复杂度棘轮 max-lines）：host 无对应
 * 类型的展示面补充 + 逃走原因码。rpcTypes 为统一再出口（消费面不变）。
 */
import { ESCAPE_REASONS, type ProposedTag } from "../host/domain/suggest-types";
export type { ProposedTag };

/** 逃走原因码（6 枚举；radio/suggest.rs ESCAPE_REASONS） */
export type EscapeReasonCode = (typeof ESCAPE_REASONS)[number];
export const ESCAPE_REASON_CODES: readonly EscapeReasonCode[] = ESCAPE_REASONS;

/** 收音机健康四元组（D13 最小可视面；三档聚合呈现） */
export interface RadioHealth {
  /** ok=正常 / warn=重试中（退避）/ fail=故障或未授权 */
  level: "ok" | "warn" | "fail";
  lastSuccessAt: string | null;
  nextPollAt: string | null;
  consecutiveFailures: number;
  pendingCount: number;
}

/** 建议卡消息视图（chat_messages 建议列 + 会话/发送者代号还原 + 置信档） */
export interface RadioMessage {
  messageId: string;
  content: string;
  chatName: string;
  senderName: string;
  receivedAt: string;
  aiStatus: "pending" | "judging" | "todo" | "update" | "followup" | "none" | "error" | "skipped";
  reviewStatus: "pending" | "accepted" | "dismissed";
  suggestedTitle: string | null;
  suggestedNote: string | null;
  suggestedCategory: string | null;
  suggestedDue: string | null;
  suggestedPriority: string | null;
  suggestedTags: ProposedTag[];
  confidence: "high" | "medium" | "low" | null;
  reason: string | null;
  dismissReason: EscapeReasonCode | "";
  taskId: number | null;
  updateTaskId: number | null;
}

/** 派发执行视图（任务卡徽标 + 详情时间线共用） */
export interface DispatchView {
  taskId: number;
  state: "queued" | "running" | "done" | "failed";
  agentId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** 派发时间线账本行（agent_sessions 投影；日志分段共用） */
export interface AgentSessionEntry {
  id: number;
  taskId: number | null;
  agentId: string;
  sessionId: string | null;
  kind: "classify" | "capture" | "dispatch_headless" | "dispatch_interactive" | "pk" | "legacy";
  durationMs: number | null;
  costUsd: number | null;
  exitCode: number | null;
  createdAt: string;
  summary: string | null;
}

/** 跟进记录（task_notes 投影） */
export interface FollowupNote {
  id: number;
  taskId: number;
  content: string;
  source: string;
  createdAt: string;
}

/** 项目派发路由（dsh:dispatch_routes 以项目标签名为键，A13） */
export interface DispatchRoute {
  tag: string;
  agentId: string;
  workdir: string;
  context: string;
}

/** 待办库状态（dbStatus；mode=ro 时面板进只读） */
export interface DbStatus {
  userVersion: number;
  pluginWindow: { min: number; max: number };
  mode: "rw" | "ro";
}

/** 诊断链路面板行（diagnosticsSnapshot；六态 health::level 原样，呈现层聚合） */
export interface DiagnosticsLink {
  provider: "feishu" | "ai";
  level: "off" | "paused" | "idle" | "ok" | "degraded" | "down";
  lastSuccessAt: string | null;
  nextPollAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  pendingCount: number;
  primaryAgent: string | null;
}

/** 运行日志行（logQuery entry；message 已过三层脱敏管线） */
export interface LogEntry {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  target: string;
  message: string;
}

/** 快捕结果（判重命中 → 更新建议待确认） */
export interface CaptureResult {
  messageId: string;
  outcome: "caught" | "updateSuggested";
  taskId: number | null;
  title: string | null;
}

/** larkTest 响应：授权身份 + 可见会话数 */
export interface LarkTestResult {
  identity: string;
  chatCount: number;
}

/** 批量分诊逐条结果 */
export interface BatchReviewOutcome {
  messageId: string;
  ok: boolean;
  error: string | null;
}

/** 备份条目（backupList/backupRun 载荷；与桌面 BackupInfo 同构） */
export interface BackupInfo {
  file: string;
  size: number;
  /** 备份时间（本地时区 RFC3339，取文件修改时间） */
  createdAt: string;
}
