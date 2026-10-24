/**
 * rpc 类型面（从 rpc.ts 拆出以控文件规模——复杂度棘轮 max-lines）：错误码 15 枚举 +
 * 69 命令 HostClient。客户端视图模型见 rpcViews.ts（本文件再出口）；rpc.ts 为统一
 * 再出口（消费面不变）。
 */
import type { PkyResult } from "../host/storage/errors";
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
// full-parity 增量契约类型（host 纯逻辑模块单源，type-only 引——AD §4.1）
import type { DeploymentDeleteResult, DeploymentEntity, DeploymentUpsertInput } from "../host/remote/deployments";
import type { ProvisionErrorTag, ProvisionStatus, ProvisionStep } from "../host/remote/provision";
import type { SessionPageResult, SessionRow } from "../host/dispatch/sessions";
import type { PomoPhaseView } from "../host/pet/pomoState";
export type {
  DeploymentDeleteResult,
  DeploymentEntity,
  DeploymentUpsertInput,
  PomoPhaseView,
  ProvisionErrorTag,
  ProvisionStatus,
  ProvisionStep,
  SessionPageResult,
  SessionRow,
};
// 客户端视图模型 + 逃走原因码（rpcViews 拆件；再出口保消费面 import 不变）
export * from "./rpcViews";
export { ERROR_CODES, _ERROR_CODE_ASSERTION } from "./rpcErrorCodes";
import type {
  BackupInfo,
  BatchReviewOutcome,
  CaptureResult,
  DbStatus,
  DeploymentListResult,
  DiagnosticsSnapshotData,
  DispatchRoute,
  DispatchView,
  EscapeReasonCode,
  ImportRunResult,
  ImportSummary,
  LarkTestResult,
  LogEntry,
  PetStatusView,
  PkSetupReportView,
  RadioHealth,
  RestoreRunResult,
  SessionGroup,
  SessionReplayRouted,
} from "./rpcViews";

// ---- 69 个 client→host RPC 命令（AD §4.1.1 表逐行 + 实体读域 5 条 + 备份/导出域 3 条 + 标签体检 3 条 + 桌宠显隐状态 1 条） ----

/**
 * HostClient：客户端半边消费的命令面。69 命令 +
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
  dispatchInteractive(params: { taskId: number; routeOverride?: string }): Promise<PkyResult<DispatchView>>;
  dispatchHeadless(params: { taskId: number; routeOverride?: string }): Promise<PkyResult<DispatchView>>;
  dispatchClose(params: { taskId: number; result: "done" | "failed"; note?: string }): Promise<PkyResult<DispatchView>>;
  dispatchReset(params: { taskId: number }): Promise<PkyResult<DispatchView>>;
  // 桌面 API parity 保留面：dsh 客户端无调用方（救援走 dispatchClose/dispatchReset、
  // 重派走 dispatchInteractive/Headless），勿当活功能维护
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
  diagnosticsSnapshot(): Promise<PkyResult<DiagnosticsSnapshotData>>;
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
  /** 显隐状态（running = helper 子进程存活；背包桌宠分区状态行回显源）+ 番茄相位最新帧
   *  （chip 精确倒计时/短休息态数据源；helper 未运行或相位到期 = null） */
  petStatus(): Promise<PkyResult<PetStatusView>>;
  petMove(params: { pos: { x: number; y: number } }): Promise<PkyResult<{ ok: boolean }>>;
  /** 重置桌宠位置（P1 D6：清宿主记忆位 + helper 即刻回默认位） */
  petResetPos(): Promise<PkyResult<{ ok: boolean; delivered: boolean }>>;
  /** Electron 首启进度（P1 D7：下载/校验/解压阶段化呈现） */
  petSetupProgress(): Promise<PkyResult<{ phase: string; at: number }>>;
  // 通用
  dbStatus(): Promise<PkyResult<DbStatus>>;
  // ---- full-parity 增量命令（AD §4.1 新 17 条中的 UI 消费面；streakInfo/larkLoginStart 随 2.9 装配补型） ----
  // 图鉴连胜（FR-B3 数据面：days/todayCount + 下一连胜里程碑阈值）
  streakInfo(): Promise<PkyResult<{ days: number; todayCount: number; nextMilestone?: number }>>;
  // lark 一键登录（FR-C3：终端注入登录命令；登录态查询沿用 larkTest/larkAuth）
  larkLoginStart(): Promise<PkyResult<{ ok: boolean; note: string }>>;
  // 会话（FR-C2：分组四选 + limit 钳 1–100 默认 20 + id 倒序；counts 不随翻页变化）
  sessionsPage(params?: {
    group?: SessionGroup;
    limit?: number;
    offset?: number;
  }): Promise<PkyResult<SessionPageResult>>;
  /** 行内回放（快照压过当前配置；部署已删/未就绪 → DEPLOYMENT_NOT_READY） */
  sessionReplay(params: { rowId: number }): Promise<PkyResult<{ routed: SessionReplayRouted }>>;
  // 远程部署（FR-RD1/RD2 · D31）
  deploymentList(): Promise<PkyResult<DeploymentListResult>>;
  /** 本机 ~/.ssh/config 可选 OpenSSH 别名（部署表单下拉数据源；缺席 = 空列表） */
  sshAliasList(): Promise<PkyResult<{ aliases: string[] }>>;
  /** 新增（无 id，保存后草稿→未就绪）/ 编辑（回落未就绪 + 提示重跑向导） */
  deploymentUpsert(params: DeploymentUpsertInput): Promise<PkyResult<{ deployment: DeploymentEntity }>>;
  /** 移除 = 关连接 + 远端 helper 托管自清理尽力执行（失败不阻塞） */
  deploymentDelete(params: { id: string }): Promise<PkyResult<DeploymentDeleteResult>>;
  /** 手动重连复核（断开态入口；结果落实体状态呈现） */
  deploymentRecheck(params: { id: string }): Promise<PkyResult<{ deployment: DeploymentEntity }>>;
  /** 开通向导单步执行（客户端步进驱动；已完成步骤跳过；restart = 全 ok 时重置重跑——重装远端组件） */
  provisionRun(params: { id: string; restart?: boolean }): Promise<PkyResult<{ status: ProvisionStatus }>>;
  /** 向导呈现（各步骤结果 + 失败步 + 可重试标记） */
  provisionStatus(params: { id: string }): Promise<PkyResult<{ status: ProvisionStatus }>>;
  /** D31 显式降级确认（须 acknowledgedRisk:true；留痕诊断段；未经确认直连态不可达） */
  deploymentDegradeConfirm(params: {
    id: string;
    acknowledgedRisk: true;
  }): Promise<PkyResult<{ deployment: DeploymentEntity }>>;
  /** pk 通道开通（ADR-0003 §3）：spawn 本机 `pk remote setup`（纯 dsh 场景先落位本机 pk）；
   *  成功端口写回部署 pkTunnel 并 resync 隧道；失败也走报告（steps 呈现分步指引，不炸信封） */
  deploymentSetupPk(params: {
    id: string;
    port?: number;
  }): Promise<PkyResult<{ report: PkSetupReportView; deployment: DeploymentEntity | null }>>;
  // 导入/恢复（FR-A5/A6 · D25 前置自动备份）
  /** 结构校验只读预检（整体拒绝 0 行变更；reasons 供弹层列表） */
  importValidate(params: { path: string }): Promise<PkyResult<{ summary: ImportSummary }>>;
  /** 执行导入（前置备份失败即中止 → BACKUP_FAILED） */
  importRun(params: { path: string; confirmed: true }): Promise<PkyResult<{ result: ImportRunResult }>>;
  /** 执行恢复（托管备份条目或白名单外部文件；超窗 → DB_SCHEMA_TOO_NEW） */
  restoreRun(params: {
    source: { backupId?: string; path?: string };
    confirmed: true;
  }): Promise<PkyResult<{ result: RestoreRunResult }>>;
  /** 文件管理器定位 exports/（不存在先建；helper 缺席 → HELPER_CAPABILITY_MISSING + hint 路径） */
  exportDirOpen(): Promise<PkyResult<{ ok: boolean; path: string }>>;
  // AX 授权（FR-A9 · D32 非 macOS 整面隐藏）
  /** 辅助功能授权状态 + helper 二进制路径（授权引导卡数据面） */
  macAuthorizationStatus(params: {
    kind: "accessibility";
  }): Promise<PkyResult<{ granted: boolean; helperPath: string }>>;
  /** 直达系统设置辅助功能面板（桥 mac-auth-query 的 host 面命令——纪要 §1；AD §4.1 未列名，联调对齐） */
  macAuthPaneOpen(): Promise<PkyResult<{ ok: boolean }>>;
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
