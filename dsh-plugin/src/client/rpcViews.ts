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

/** 项目派发路由（dsh:dispatch_routes 以项目标签名为键，A13；
 *  full-parity 增量可选 deployment = 执行世界部署别名——旧路由无此字段 = 本机） */
export interface DispatchRoute {
  tag: string;
  agentId: string;
  workdir: string;
  context: string;
  deployment?: string;
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

// ---- full-parity 客户端视图模型（AD §4.1 增量契约的呈现面） ----

/** 部署列表响应（deploymentList）：实体 + 三档计数 */
export interface DeploymentListResult {
  deployments: import("./rpcTypes").DeploymentEntity[];
  counts: { ready: number; pending: number; broken: number };
}

/** 会话分组四选（M9 归组：classify/capture→radio、dispatch_*→dispatch、pk→other、未知仅入 all） */
export type SessionGroup = "all" | "radio" | "dispatch" | "other";

/** 回放路由结果（sessionReplay；快照压过当前配置） */
export interface SessionReplayRouted {
  world: "local" | { deploymentAlias: string };
  note?: string;
}

/** 导入文件结构预检摘要（importValidate；reasons = 校验失败原因列表，0 行变更） */
export interface ImportSummary {
  app: string;
  schemaVersion: number;
  counts: Record<string, number>;
  compatible: boolean;
  /** 校验失败原因（整体拒绝呈现；空数组 = 通过） */
  reasons?: string[];
  /** 前置自动备份将落的文件名（确认弹层实文件名呈现；host 侧在 validate 期给出） */
  backupFile?: string;
}

/** 导入执行结果（importRun：前置备份 → 整体替换；applied = 变更计数） */
export interface ImportRunResult {
  backupId: string;
  applied: number;
}

/** 恢复执行结果（restoreRun：备份 → 补跑迁移 + 默认分类补种） */
export interface RestoreRunResult {
  backupId: string;
  migratedTo: number;
  seeded: number;
}

/** dsh-ssh 家族探测呈现投影（diagnosticsSnapshot.sshFamily；detail = 装载指引命令） */
export interface SshFamilyView {
  ok: boolean;
  detail?: string | null;
}

/** diagnosticsSnapshot 增量载荷（AD §4.1 既有命令响应面增量，签名不变——旧字段缺省兼容） */
export interface DiagnosticsSnapshotData {
  links: DiagnosticsLink[];
  /** hello.caps 能力位矩阵（null = helper 未运行/hello 未达 → HelperBanner + 矩阵全降级） */
  helperCaps: Record<string, boolean> | null;
  /** 全局快捷键启动期注册结果（null = 未知；false 才显行） */
  shortcutRegistered: boolean | null;
  /** dsh-ssh 家族探测投影（null = 未知不显行） */
  sshFamily: SshFamilyView | null;
  /** helper 运行时版本（可选——矩阵「运行时来源与版本」行；null 不显） */
  helperVersion?: string | null;
}

/** helper 能力矩阵六行呈现位 → hello.caps 能力位键（纪要④：8 位归并六行呈现） */
export const HELPER_CAP_ROWS: ReadonlyArray<{ id: string; cap: string }> = [
  { id: "tray", cap: "sys-tray" },
  { id: "shortcut", cap: "sys-shortcut" },
  { id: "notify", cap: "sys-notify" },
  { id: "dialog", cap: "sys-dialog" },
  { id: "tts", cap: "sys-tts" },
  { id: "input", cap: "input-count" },
];

/**
 * 错误码等值判定（envelope.code 对未入 ERROR_CODES 枚举的码宽收比较——
 * full-parity 增量码（DEPLOYMENT_NOT_READY/PROVISION_STEP_FAILED/HELPER_HASH_MISMATCH/
 * HELPER_CAPABILITY_MISSING）由任务 2.9 归 PROTOCOL §2 单源扩容，客户端先经此宽面判定，
 * 枚举扩容后行为不变）。
 */
export function isErrorCode(error: { code: string } | null | undefined, code: string): boolean {
  return error !== null && error !== undefined && error.code === code;
}
