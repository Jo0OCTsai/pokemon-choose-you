/**
 * mockHost 内存实现 · 状态与组装（供组件测试；真实语义子集）。命令实现按域拆分：
 * 任务/快捕/分诊 → mockTasks.ts；派发 → mockDispatch.ts；设置/背包 → mockPanels.ts；
 * 诊断/桌宠/通用 → mockMisc.ts；实体读 → mockRead.ts。rpc.ts 统一再出口，消费面不变。
 */
import { fail, PkyError, type PkyResult } from "../host/storage/errors";
import type { HostClient, PageOpenEvent } from "./rpc";
import type {
  AgentSessionEntry,
  DbStatus,
  DiagnosticsLink,
  FollowupNote,
  LogEntry,
  RadioHealth,
  RadioMessage,
} from "./rpcTypes";
import type { Task } from "../host/domain/tasks";
import { taskSwitchCommands, taskCloseCommands, releaseCommands, taskEditCommands } from "./mockTasks";
import { captureCommands, acceptCommands, dismissCommands, retryCommands } from "./mockReview";
import { dispatchCommands, dispatchControlCommands } from "./mockDispatch";
import { settingsCommands, categoryCommands, vocabularyCommands, agentCommands, filterCommands } from "./mockPanels";
import { promptCommands } from "./mockPrompts";
import { diagCommands, logCommands, miscCommands } from "./mockMisc";
import { readCommands } from "./mockRead";

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

/** 默认内存态（空库 + 健康绿灯 + 读写库） */
function defaultState(): MockHostState {
  return {
    tasks: [],
    categories: [],
    messages: [],
    settings: {},
    agents: [],
    health: {
      level: "ok",
      lastSuccessAt: "2026-10-11T08:00:00+08:00",
      nextPollAt: "2026-10-11T08:02:00+08:00",
      consecutiveFailures: 0,
      pendingCount: 0,
    },
    dbStatus: { userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "rw" },
    larkAuthorized: true,
    filters: [],
    logEntries: [],
    diagnostics: [],
    promptSpecs: [],
    deleted: [],
    sessions: [],
    followups: {},
    taskLogs: {},
  };
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
      return state.dbStatus.mode === "ro"
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
    ...agentCommands(ctx),
    ...filterCommands(ctx),
    ...promptCommands(ctx),
    ...diagCommands(ctx),
    ...logCommands(ctx),
    ...miscCommands(ctx),
    ...readCommands(ctx),
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
