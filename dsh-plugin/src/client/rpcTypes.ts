/**
 * rpc 类型面（从 rpc.ts 拆出以控文件规模——复杂度棘轮 max-lines）：错误码 15 枚举 +
 * 60 命令 HostClient。客户端视图模型见 rpcViews.ts（本文件再出口）；rpc.ts 为统一
 * 再出口（消费面不变）。
 */
import type { ErrorCode, PkyResult } from "../host/storage/errors";
import type { Task, TaskNote, TaskLog, TaskPatch } from "../host/domain/tasks";
import type { AgentConfig } from "../host/domain/settings";
import type { PromptSpecInfo } from "../host/domain/prompt-overrides";
import type { Category } from "../host/domain/vocabulary";
import type { Tag, TagDimension } from "../host/domain/vocabulary-tags";
import type { TagCheckupReport } from "../host/domain/tag-health";
export type { TagCheckupReport } from "../host/domain/tag-health";
import type { FilterItem, FilterState } from "../host/domain/vocabulary-filters";
import type { PanelSnapshot, TaskDetail } from "../host/commands/readCommands";
export type { PanelSnapshot, TaskDetail } from "../host/commands/readCommands";
// 客户端视图模型 + 逃走原因码（rpcViews 拆件；再出口保消费面 import 不变）
export * from "./rpcViews";
import type {
  BackupInfo,
  BatchReviewOutcome,
  CaptureResult,
  DbStatus,
  DiagnosticsLink,
  DispatchRoute,
  DispatchView,
  EscapeReasonCode,
  LarkTestResult,
  LogEntry,
  RadioHealth,
} from "./rpcViews";

// ---- 错误码（15 枚举；与 host/storage/errors ERROR_CODES 逐字一致——类型级双向断言） ----

/** 15 个业务错误码（uiux 契约需求面交互状态表单源） */
export const ERROR_CODES = [
  "JUDGE_TIMEOUT",
  "JUDGE_INVALID_RESULT",
  "LARK_FETCH_FAILED",
  "LARK_UNAUTHORIZED",
  "DISPATCH_TIMEOUT",
  "DISPATCH_LAUNCH_FAILED",
  "DB_SCHEMA_TOO_NEW",
  "DSH_VERSION_UNSUPPORTED",
  "SSH_AUTH_REQUIRED",
  "SUGGESTION_ALREADY_RESOLVED",
  "DISPATCH_ALREADY_ACTIVE",
  "CONFIG_VALIDATION_FAILED",
  "AGENT_COMMAND_INVALID",
  "PROMPT_VALIDATION_FAILED",
  "SETTING_MODIFIED_ELSEWHERE",
] as const satisfies readonly ErrorCode[];

/** 双向集合相等断言：本表 ⊇ host 表 且 host 表 ⊆ 本表（漂移即编译红） */
type _AssertCoversHost = Exclude<ErrorCode, (typeof ERROR_CODES)[number]>;
type _AssertNoExtra = Exclude<(typeof ERROR_CODES)[number], ErrorCode>;
type _AssertExact = [_AssertCoversHost] extends [never] ? ([_AssertNoExtra] extends [never] ? true : never) : never;
/** 编译期锚点（导出防 noUnusedLocals；断言通过时为 true，漂移时 never 拒绝赋值） */
export const _ERROR_CODE_ASSERTION: _AssertExact = true;

// ---- 60 个 client→host RPC 命令（AD §4.1.1 表逐行 + 实体读域 5 条 + 备份/导出域 3 条 + 标签体检 3 条） ----

/**
 * HostClient：客户端半边消费的命令面。60 命令（57 + 标签体检 3 条）+
 * 放生撤销（UIUX 触发入口表 host:taskDeleteUndo——墓碑审计恢复，AD §4.1.1 归并口径的显式
 * 撤销面）+ pageOpen 推送订阅。
 */
export interface HostClient {
  // 任务
  taskStart(params: { taskId: number }): Promise<PkyResult<Task>>;
  taskPause(params?: { taskId?: number }): Promise<PkyResult<Task | null>>;
  taskResume(params?: { taskId?: number }): Promise<PkyResult<Task | null>>;
  taskComplete(params?: { taskId?: number }): Promise<PkyResult<Task>>;
  taskCancel(params: { taskId: number; reasonCode: EscapeReasonCode }): Promise<PkyResult<Task>>;
  taskDelete(params: { taskId: number }): Promise<PkyResult<{ taskId: number }>>;
  /** 放生撤销（5 秒窗口内恢复任务与级联数据） */
  taskDeleteUndo(params: { taskId: number }): Promise<PkyResult<Task>>;
  taskReschedule(params: { taskId: number; due?: string }): Promise<PkyResult<Task>>;
  /** 全字段编辑（桌面 TaskEditModal 同位；域内含 diff 审计） */
  taskUpdate(params: TaskPatch): Promise<PkyResult<Task>>;
  /** 添加跟进记录（source=manual） */
  taskNoteAdd(params: { taskId: number; content: string }): Promise<PkyResult<TaskNote>>;
  /** 删除跟进记录（幂等） */
  taskNoteDelete(params: { id: number }): Promise<PkyResult<{ ok: boolean }>>;
  /** 操作历史（task_logs 倒序 200 条封顶） */
  taskHistory(params: { taskId: number }): Promise<PkyResult<{ logs: TaskLog[] }>>;
  // 快捕
  captureTodo(params: { text: string }): Promise<PkyResult<CaptureResult>>;
  // 分诊
  reviewAccept(params: { messageId: string }): Promise<PkyResult<{ taskId: number | null; messageId: string }>>;
  reviewApplyUpdate(params: { messageId: string }): Promise<PkyResult<{ taskId: number | null; messageId: string }>>;
  reviewDismiss(params: { messageId: string; reasonCode: EscapeReasonCode }): Promise<PkyResult<{ messageId: string }>>;
  reviewRestore(params: { messageId: string }): Promise<PkyResult<{ messageId: string }>>;
  reviewBatch(params: {
    messageIds: string[];
    op: "accept" | "dismiss";
    reasonCode?: EscapeReasonCode;
  }): Promise<PkyResult<{ results: BatchReviewOutcome[] }>>;
  // 失败组
  retryJudge(params: { messageIds: string[] | "all" }): Promise<PkyResult<{ accepted: number }>>;
  forceCapture(params: { messageId: string }): Promise<PkyResult<{ taskId: number | null; messageId: string }>>;
  forceDismiss(params: { messageId: string; reasonCode?: EscapeReasonCode }): Promise<PkyResult<{ messageId: string }>>;
  // 收音机
  pollNow(): Promise<PkyResult<RadioHealth>>;
  // 派发
  dispatchInteractive(params: {
    taskId: number;
    routeOverride?: Partial<DispatchRoute>;
  }): Promise<PkyResult<DispatchView>>;
  dispatchHeadless(params: {
    taskId: number;
    routeOverride?: Partial<DispatchRoute>;
  }): Promise<PkyResult<DispatchView>>;
  dispatchClose(params: { taskId: number; result: "done" | "failed"; note?: string }): Promise<PkyResult<DispatchView>>;
  dispatchReset(params: { taskId: number }): Promise<PkyResult<DispatchView>>;
  dispatchCancel(params: { taskId: number }): Promise<PkyResult<DispatchView>>;
  dispatchRedo(params: { taskId: number }): Promise<PkyResult<DispatchView>>;
  // 设置
  configRead(params: { keys?: string[] }): Promise<PkyResult<{ keyValues: Record<string, string> }>>;
  configWrite(params: { keyValues: Record<string, string> }): Promise<PkyResult<{ ok: boolean }>>;
  routeUpsert(params: { route: DispatchRoute }): Promise<PkyResult<DispatchRoute>>;
  larkAuth(): Promise<PkyResult<{ launched: boolean }>>;
  larkTest(): Promise<PkyResult<LarkTestResult>>;
  // 背包
  categoryUpsert(params: {
    id?: number;
    name?: string;
    pokemon?: string;
    sprite?: string;
    enabled?: boolean;
    description?: string;
  }): Promise<PkyResult<Category>>;
  categoryDelete(params: { id: number }): Promise<PkyResult<{ id: number; movedTaskCount: number }>>;
  tagUpsert(params: { id?: number; name: string; dimension: string; description?: string }): Promise<PkyResult<Tag>>;
  tagDelete(params: { id: number }): Promise<PkyResult<{ id: number }>>;
  dimensionUpdate(params: {
    key: string;
    name: string;
    maxTags?: number;
    enabled?: boolean;
  }): Promise<PkyResult<TagDimension>>;
  filterList(): Promise<PkyResult<{ chats: FilterItem[]; counts: Record<string, number>; lastPollAt: string | null }>>;
  filterUpsert(params: { chatId: string; state: FilterState }): Promise<PkyResult<FilterItem>>;
  // 标签体检（复盘向导「标签体检」步：本地预筛报告 + 治理动作；dsh 无 LLM 复核，judged 恒 false）
  tagCheckup(): Promise<PkyResult<TagCheckupReport>>;
  /** 近义合并：from 的任务关联全部改挂 into 后删除 from */
  tagMerge(params: { fromId: number; intoId: number }): Promise<PkyResult<{ ok: boolean }>>;
  /** 采纳新维度：key 已存在复用，否则新建（multi/30）并校验 key 与配额 */
  tagMoveDimension(params: { tagIds: number[]; key: string; name: string }): Promise<PkyResult<{ ok: boolean }>>;
  agentUpsert(params: {
    agent: AgentConfig;
    expectedAgentIds?: string[];
    force?: boolean;
  }): Promise<PkyResult<{ agents: AgentConfig[] }>>;
  agentDelete(params: {
    id: string;
    expectedAgentIds?: string[];
    force?: boolean;
  }): Promise<PkyResult<{ agents: AgentConfig[] }>>;
  /** 连接测试探针（ai::test 同构）：无头执行器跑 pk context，结果以数据面带回 */
  agentTest(params?: { agentId?: string }): Promise<PkyResult<{ connected: boolean; message: string }>>;
  /** pk 技能本机安装状态（kind 推断失败 → INVALID_ARGUMENT 信封带指引；command/dir
   *  覆盖 = 编辑态草稿值优先，缺省回落已存 agent 配置） */
  pkSkillCheck(params?: { agentId?: string; command?: string; dir?: string }): Promise<
    PkyResult<{
      kind: string;
      dir: string;
      installed: boolean;
      installedVersion: string | null;
      bundledVersion: string;
    }>
  >;
  /** pk 技能安装/同步（写 SKILL.md + references/；返回旧版本供「已从 v? 升级」展示） */
  pkSkillInstall(params?: {
    agentId?: string;
    command?: string;
    dir?: string;
  }): Promise<PkyResult<{ kind: string; dir: string; previousVersion: string | null; version: string; path: string }>>;
  promptList(): Promise<PkyResult<{ specs: PromptSpecInfo[] }>>;
  promptGet(params: { key: string }): Promise<PkyResult<PromptSpecInfo>>;
  promptOverride(params: {
    key: string;
    value: string;
    expectedValue?: string;
    force?: boolean;
  }): Promise<PkyResult<{ spec: PromptSpecInfo; unknownPlaceholders: string[] }>>;
  promptReset(params: { key: string; expectedValue?: string; force?: boolean }): Promise<PkyResult<PromptSpecInfo>>;
  // 诊断
  diagnosticsSnapshot(): Promise<PkyResult<{ links: DiagnosticsLink[] }>>;
  supportReport(): Promise<PkyResult<{ text: string }>>;
  logQuery(params: {
    minLevel?: LogEntry["level"];
    target?: string;
    offset?: number;
    limit?: number;
  }): Promise<PkyResult<{ entries: LogEntry[]; total: number }>>;
  // 桌宠
  petShow(): Promise<PkyResult<{ ok: boolean }>>;
  petHide(): Promise<PkyResult<{ ok: boolean }>>;
  petMove(params: { pos: { x: number; y: number } }): Promise<PkyResult<{ ok: boolean }>>;
  // 通用
  dbStatus(): Promise<PkyResult<DbStatus>>;
  // 实体读（Phase B 契约缺口补齐：panelSnapshot 面板首载聚合；其余按需懒载）
  panelSnapshot(): Promise<PkyResult<PanelSnapshot>>;
  taskDetail(params: { taskId: number }): Promise<PkyResult<TaskDetail>>;
  taskSearch(params: { query: string }): Promise<PkyResult<{ tasks: Task[] }>>;
  todayTasks(): Promise<PkyResult<{ tasks: Task[] }>>;
  categoriesList(): Promise<PkyResult<{ categories: Category[] }>>;
  // 专注
  pomoTryFive(params?: { taskId?: number }): Promise<PkyResult<{ ok: boolean }>>;
  // 备份/导出（手动快照 + 滚动保留 + 三种导出；恢复/导入不在命令面）
  /** 立即备份：返回新文件名与滚动保留后的列表 */
  backupRun(): Promise<PkyResult<{ file: string; files: BackupInfo[] }>>;
  /** 备份列表（时间倒序；目录不存在为空列表） */
  backupList(): Promise<PkyResult<{ backups: BackupInfo[] }>>;
  /** 数据导出：全量 JSON / 任务 CSV / 今日日报，返回写入的完整路径 */
  exportRun(params: { kind: "json" | "csv" | "report" }): Promise<PkyResult<{ path: string }>>;
  // host→客户端推送：打开插件页面（可选目标分段锚点）
  onPageOpen(listener: (event: PageOpenEvent) => void): () => void;
}

/** pageOpen 推送事件（双击桌宠/chip 点击经宿主导航打开本插件页面） */
export interface PageOpenEvent {
  section?: "panel" | "settings";
}

/** 目标分段锚点（host:pageOpen 的 section 参数） */
export type PageSection = "panel" | "settings";
