/**
 * mockHost 内存实现 · 状态与组装（供组件测试；真实语义子集）。命令实现按域拆分：
 * 任务/快捕/分诊 → mockTasks.ts；派发 → mockDispatch.ts；设置/背包 → mockPanels.ts；
 * 复盘向导标签体检 → mockTagHealth.ts；诊断/桌宠/通用 → mockMisc.ts；实体读 → mockRead.ts；
 * 默认态工厂 → mockState.ts。rpc.ts 统一再出口，消费面不变。
 */
import { fail, PkyError, type PkyResult } from "../host/storage/errors";
import type { HostClient, PageOpenEvent } from "./rpc";
import type {
  AgentSessionEntry,
  DbStatus,
  DiagnosticsLink,
  FollowupNote,
  LogEntry,
  PomoPhaseView,
  RadioHealth,
  RadioMessage,
  RestoreRunResult,
  BackupInfo,
  ImportSummary,
  TagCheckupReport,
  TunnelStatusView,
} from "./rpcTypes";
import type { Task } from "../host/domain/tasks";
import { taskSwitchCommands, taskCloseCommands, releaseCommands, taskEditCommands } from "./mockTasks";
import { captureCommands, acceptCommands, dismissCommands, retryCommands } from "./mockReview";
import { dispatchCommands, dispatchControlCommands } from "./mockDispatch";
import { settingsCommands, categoryCommands, vocabularyCommands, agentCommands, filterCommands } from "./mockPanels";
import { agentToolsCommands } from "./mockAgentTools";
import { tagHealthCommands } from "./mockTagHealth";
import { promptCommands } from "./mockPrompts";
import { diagCommands, logCommands, miscCommands } from "./mockMisc";
import { readCommands } from "./mockRead";
import { backupCommands } from "./mockBackup";
import { deploymentCommands, provisionCommands, sessionCommands, type MockProvisionFailKind } from "./mockRemote";
import { defaultState } from "./mockState";
import type { Tag, TagDimension } from "../host/domain/vocabulary-tags";
import type { DeploymentEntity } from "../host/remote/deployments";
import type { ProvisionStep } from "../host/remote/provision";

/** mockHost 可配置的内存态（组件测试的夹具面） */
export interface MockHostState {
  tasks: Task[];
  categories: import("../host/domain/vocabulary").Category[];
  messages: RadioMessage[];
  settings: Record<string, string>;
  agents: import("../host/domain/settings").AgentConfig[];
  health: RadioHealth;
  dbStatus: DbStatus;
  larkAuthorized: boolean;
  filters: import("../host/domain/vocabulary-filters").FilterItem[];
  logEntries: LogEntry[];
  diagnostics: DiagnosticsLink[];
  /** 提示词目录（promptList/promptGet 消费） */
  promptSpecs: import("../host/domain/prompt-overrides").PromptSpecInfo[];
  /** 放生墓碑（taskDeleteUndo 的 5 秒撤销窗语义） */
  deleted: Task[];
  /** agent 会话账本（panelSnapshot logs / taskDetail timeline 消费） */
  sessions: AgentSessionEntry[];
  /** taskId → 跟进记录流（taskDetail 消费） */
  followups: Record<number, FollowupNote[]>;
  /** taskId → 操作日志（taskHistory 消费；缺省空） */
  taskLogs: Record<number, import("../host/domain/tasks").TaskLog[]>;
  /** 备份列表（backupList/backupRun 消费；缺省空） */
  backups: BackupInfo[];
  /** 词表夹具（tagMerge/tagMoveDimension/tagDelete 的真实移改对象；复盘向导「采纳」按名解析 id 的数据面） */
  tags: Tag[];
  /** 维度夹具（tagMoveDimension 复用/新建维度；缺省空） */
  dimensions: TagDimension[];
  /** 标签体检固定报告（tagCheckup 消费；缺省空报告） */
  tagCheckup: TagCheckupReport;
  /** pk 技能 mock 状态（pkSkillCheck/Install 消费；缺省未检查） */
  pkSkill?: import("./mockAgentTools").MockPkSkillState;
  /** 桌宠显隐（petStatus 消费；缺省 true——随宿主启动语义） */
  petRunning: boolean;
  /** 番茄相位最新帧（petStatus 随行；缺省 null = 无相位——chip 回落已专注时长快照） */
  pomodoro: PomoPhaseView | null;
  // ---- full-parity 增量态（specs/dsh-plugin-full-parity） ----
  /** 部署实体（deploymentList/Upsert/Delete/Recheck/provision* 消费） */
  deployments: DeploymentEntity[];
  /** 常驻隧道状态按部署 id（deploymentList 随行；缺项 = 隧道面未装配 null） */
  tunnelStates: Record<string, TunnelStatusView>;
  /** 本机 ~/.ssh/config 可选别名（sshAliasList 消费——部署表单下拉数据源） */
  sshAliases: string[];
  /** 开通向导单步失败编排（provisionRun 消费；null = 全步骤成功；测试中途可改写模拟重试成功） */
  provisionFail: { step: ProvisionStep; kind: MockProvisionFailKind; message?: string } | null;
  /** pk 通道开通失败编排（deploymentSetupPk 消费；null = 成功——报告含失败分步指引） */
  pkSetupFail: { detail: string } | null;
  /** 重连复核结局（deploymentRecheck 消费——断开态部署恢复 ready 还是保持断开；对齐真实宿主两分支） */
  recheckRecovers: boolean;
  /** 会话账本行（sessionsPage/sessionReplay 消费——与既有 sessions 分立） */
  sessionRows: import("../host/dispatch/sessions").SessionRow[];
  dispatchHandoff: { reason?: "web-carrier" | "no-terminal" | "spawn-failed" }; // handoff 原因编排（web 提示用例）
  /** 导入文件夹具（importValidate/importRun 按 path 匹配；reasons = 校验失败原因列表） */
  importFiles: Array<{
    path: string;
    summary?: ImportSummary;
    reasons?: string[];
    backupFail?: boolean;
  }>;
  /** importRun 成功产物（缺省固定值） */
  importResult: { backupId: string; applied: number };
  /** 恢复结果编排（null = 成功；code = 业务错误码名） */
  restoreOutcome:
    | { ok: true; result: RestoreRunResult }
    | { ok: false; code: "DB_SCHEMA_TOO_NEW" | "BACKUP_FAILED" | "IMPORT_VALIDATION_FAILED"; message: string }
    | null;
  /** 打开导出目录编排（error 非空 = 失败 toast 面；path = exports 目录） */
  exportDir: { path: string; error?: string };
  /** AX 授权状态（macAuthorizationStatus 消费） */
  macAuth: { granted: boolean; helperPath: string };
  /** helper 能力位矩阵（diagnosticsSnapshot；null = helper 缺席 → HelperBanner + 矩阵全降级） */
  helperCaps: Record<string, boolean> | null;
  /** 全局快捷键注册结果（diagnosticsSnapshot；false 才显诊断行） */
  shortcutRegistered: boolean;
  /** dsh-ssh 家族探测（diagnosticsSnapshot；detail = 装载指引命令；null = 未知——矩阵不显行） */
  sshFamily: { ok: boolean; detail?: string | null } | null;
  /** helper 运行时版本（diagnosticsSnapshot 可选呈现；null 不显） */
  helperVersion: string | null;
}

/** 调用记录（断言命令面与参数） */
export interface MockCall {
  command: string;
  params: unknown;
}

export interface MockHost extends HostClient {
  state: MockHostState;
  calls: MockCall[];
  /** 测试侧模拟宿主推送 pageOpen */
  emitPageOpen(event: PageOpenEvent): void;
}

/** 命令实现组的共享上下文（各域 builder 的依赖面） */
export interface MockContext {
  state: MockHostState;
  calls: MockCall[];
  record(command: string, params?: unknown): void;
  findTask(id: number): Task | undefined;
  findMessage(messageId: string): RadioMessage | undefined;
  /** 只读模式守卫：写命令统一撞 DB_SCHEMA_TOO_NEW（§4.2 禁用清单的协议侧） */
  guardWritable(): PkyError | null;
  /** 分诊 CAS：非 pending → SUGGESTION_ALREADY_RESOLVED */
  guardPending(messageId: string): PkyError | null;
  nextTaskId(): number;
  ok<T>(data: T): Promise<PkyResult<T>>;
}

function delay<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function createContext(initial: Partial<MockHostState>): MockContext {
  const state: MockHostState = { ...defaultState(), ...initial };
  const calls: MockCall[] = [];
  return {
    state,
    calls,
    record(command, params) {
      calls.push({ command, params: params ?? {} });
    },
    findTask(id) {
      return state.tasks.find((t) => t.id === id);
    },
    findMessage(messageId) {
      return state.messages.find((m) => m.messageId === messageId);
    },
    guardWritable() {
      return state.dbStatus.mode === "readonly"
        ? new PkyError("DB_SCHEMA_TOO_NEW", "待办库版本较新，需升级插件后才能写入")
        : null;
    },
    guardPending(messageId) {
      const message = state.messages.find((m) => m.messageId === messageId);
      if (message === undefined) {
        return new PkyError("INVALID_ARGUMENT", `消息 ${messageId} 不存在`);
      }
      return message.reviewStatus === "pending"
        ? null
        : new PkyError("SUGGESTION_ALREADY_RESOLVED", "该建议已在另一处处置");
    },
    nextTaskId() {
      return state.tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    },
    ok(data) {
      return delay({ ok: true, data });
    },
  };
}

/** 失败信封便捷件（各域 builder 共用） */
export function mockFail<T = never>(error: PkyError): Promise<PkyResult<T>> {
  return delay(fail(error));
}

/**
 * 内存 HostClient 工厂：组装各域命令组（语义子集——状态机流转、CAS 幂等、设置读写、
 * agent/提示词修订检测），全部调用记录进 calls 供断言。
 */
export function mockHost(initial: Partial<MockHostState> = {}): MockHost {
  const ctx = createContext(initial);
  const pageOpenListeners = new Set<(event: PageOpenEvent) => void>();
  const host = {
    ...taskSwitchCommands(ctx),
    ...taskCloseCommands(ctx),
    ...releaseCommands(ctx),
    ...taskEditCommands(ctx),
    ...captureCommands(ctx),
    ...acceptCommands(ctx),
    ...dismissCommands(ctx),
    ...retryCommands(ctx),
    ...dispatchCommands(ctx),
    ...dispatchControlCommands(ctx),
    ...settingsCommands(ctx),
    ...categoryCommands(ctx),
    ...vocabularyCommands(ctx),
    ...tagHealthCommands(ctx),
    ...agentCommands(ctx),
    ...agentToolsCommands(ctx),
    ...filterCommands(ctx),
    ...promptCommands(ctx),
    ...diagCommands(ctx),
    ...logCommands(ctx),
    ...miscCommands(ctx),
    ...readCommands(ctx),
    ...backupCommands(ctx),
    ...deploymentCommands(ctx),
    ...provisionCommands(ctx),
    ...sessionCommands(ctx),
    onPageOpen(listener: (event: PageOpenEvent) => void) {
      pageOpenListeners.add(listener);
      return () => {
        pageOpenListeners.delete(listener);
      };
    },
  } as unknown as MockHost;
  host.state = ctx.state;
  host.calls = ctx.calls;
  host.emitPageOpen = (event) => {
    for (const listener of pageOpenListeners) {
      listener(event);
    }
  };
  return host;
}
