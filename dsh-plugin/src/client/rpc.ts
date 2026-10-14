/**
 * 客户端半边 RPC 层（AD §4.1.1 host 命令契约）：
 * - HostClient（57 命令类型面——49 Phase A + 5 实体读域 + 3 备份/导出域）与错误码/
 *   视图模型见 rpcTypes.ts（本文件再出口，消费面 import 不变）；内存 mockHost 见 mockHost.ts（同样再出口）。
 * - ok/fail 响应信封 + 可注入 transport（真实 dsh 桥后续接；测试用 mockHost 内存实现）。
 *
 * 类型源只读引用 src/host/**（域核心），不反向依赖其运行时（errors.ts 为零依赖模块，例外直引）。
 * dsh 适配层（真实 slots 注册/路由桥）不在本层——本层只约定 transport 形状。
 */
import { ok, fail, PkyError, type ErrorCode, type PkyErrorShape, type PkyResult } from "../host/storage/errors";
import type { HostClient, PageOpenEvent } from "./rpcTypes";

export { ok, fail, PkyError };
export type { ErrorCode, PkyErrorShape, PkyResult };
export * from "./rpcTypes";
// 实体读域载荷类型（host readCommands 单源；在此再出口保消费面 import 路径不变）
export type {
  PanelSnapshot,
  PanelMessage,
  PanelRadioHealth,
  PanelSession,
  PanelFollowup,
  TaskDetail,
} from "../host/commands/readCommands";
export { mockHost, type MockHost, type MockHostState, type MockCall } from "./mockHost";

// ---- 可注入 transport ----

/**
 * transport 形状：真实 dsh 桥后续实现（宿主半边 RPC 通道）；测试注入内存 mock。
 * send 统一返回 ok/fail 信封；push 通道承载 pageOpen 推送。
 */
export interface HostTransport {
  send<T>(command: string, params?: unknown): Promise<PkyResult<T>>;
  on(event: "pageOpen", listener: (event: PageOpenEvent) => void): () => void;
}

type Sender = <T>(command: string, params?: unknown) => Promise<PkyResult<T>>;

/** 任务/快捕/分诊/失败组/收音机命令门面（组内每方法一行转发） */
function taskFacade(
  call: Sender,
): Pick<
  HostClient,
  | "taskStart"
  | "taskPause"
  | "taskResume"
  | "taskComplete"
  | "taskCancel"
  | "taskDelete"
  | "taskDeleteUndo"
  | "taskReschedule"
  | "taskUpdate"
  | "taskNoteAdd"
  | "taskNoteDelete"
  | "taskHistory"
  | "captureTodo"
  | "reviewAccept"
  | "reviewApplyUpdate"
  | "reviewDismiss"
  | "reviewRestore"
  | "reviewBatch"
  | "retryJudge"
  | "forceCapture"
  | "forceDismiss"
  | "pollNow"
> {
  return {
    taskStart: (p) => call("taskStart", p),
    taskPause: (p) => call("taskPause", p),
    taskResume: (p) => call("taskResume", p),
    taskComplete: (p) => call("taskComplete", p),
    taskCancel: (p) => call("taskCancel", p),
    taskDelete: (p) => call("taskDelete", p),
    taskDeleteUndo: (p) => call("taskDeleteUndo", p),
    taskReschedule: (p) => call("taskReschedule", p),
    taskUpdate: (p) => call("taskUpdate", p),
    taskNoteAdd: (p) => call("taskNoteAdd", p),
    taskNoteDelete: (p) => call("taskNoteDelete", p),
    taskHistory: (p) => call("taskHistory", p),
    captureTodo: (p) => call("captureTodo", p),
    reviewAccept: (p) => call("reviewAccept", p),
    reviewApplyUpdate: (p) => call("reviewApplyUpdate", p),
    reviewDismiss: (p) => call("reviewDismiss", p),
    reviewRestore: (p) => call("reviewRestore", p),
    reviewBatch: (p) => call("reviewBatch", p),
    retryJudge: (p) => call("retryJudge", p),
    forceCapture: (p) => call("forceCapture", p),
    forceDismiss: (p) => call("forceDismiss", p),
    pollNow: () => call("pollNow"),
  };
}

/** 派发/设置命令门面 */
function dispatchFacade(
  call: Sender,
): Pick<
  HostClient,
  | "dispatchInteractive"
  | "dispatchHeadless"
  | "dispatchClose"
  | "dispatchReset"
  | "dispatchCancel"
  | "dispatchRedo"
  | "configRead"
  | "configWrite"
  | "routeUpsert"
  | "larkAuth"
  | "larkTest"
> {
  return {
    dispatchInteractive: (p) => call("dispatchInteractive", p),
    dispatchHeadless: (p) => call("dispatchHeadless", p),
    dispatchClose: (p) => call("dispatchClose", p),
    dispatchReset: (p) => call("dispatchReset", p),
    dispatchCancel: (p) => call("dispatchCancel", p),
    dispatchRedo: (p) => call("dispatchRedo", p),
    configRead: (p) => call("configRead", p),
    configWrite: (p) => call("configWrite", p),
    routeUpsert: (p) => call("routeUpsert", p),
    larkAuth: () => call("larkAuth"),
    larkTest: () => call("larkTest"),
  };
}

/** 背包（词表/agent/提示词）命令门面 */
function backpackFacade(
  call: Sender,
): Pick<
  HostClient,
  | "categoryUpsert"
  | "categoryDelete"
  | "tagUpsert"
  | "tagDelete"
  | "dimensionUpdate"
  | "filterList"
  | "filterUpsert"
  | "agentUpsert"
  | "agentDelete"
  | "promptList"
  | "promptGet"
  | "promptOverride"
  | "promptReset"
> {
  return {
    categoryUpsert: (p) => call("categoryUpsert", p),
    categoryDelete: (p) => call("categoryDelete", p),
    tagUpsert: (p) => call("tagUpsert", p),
    tagDelete: (p) => call("tagDelete", p),
    dimensionUpdate: (p) => call("dimensionUpdate", p),
    filterList: () => call("filterList"),
    filterUpsert: (p) => call("filterUpsert", p),
    agentUpsert: (p) => call("agentUpsert", p),
    agentDelete: (p) => call("agentDelete", p),
    promptList: () => call("promptList"),
    promptGet: (p) => call("promptGet", p),
    promptOverride: (p) => call("promptOverride", p),
    promptReset: (p) => call("promptReset", p),
  };
}

/** 诊断/桌宠/通用/专注命令门面 */
function miscFacade(
  call: Sender,
): Pick<
  HostClient,
  | "diagnosticsSnapshot"
  | "supportReport"
  | "logQuery"
  | "petShow"
  | "petHide"
  | "petMove"
  | "dbStatus"
  | "pomoTryFive"
  | "panelSnapshot"
  | "taskDetail"
  | "taskSearch"
  | "todayTasks"
  | "categoriesList"
> {
  return {
    diagnosticsSnapshot: () => call("diagnosticsSnapshot"),
    supportReport: () => call("supportReport"),
    logQuery: (p) => call("logQuery", p),
    petShow: () => call("petShow"),
    petHide: () => call("petHide"),
    petMove: (p) => call("petMove", p),
    dbStatus: () => call("dbStatus"),
    pomoTryFive: (p) => call("pomoTryFive", p),
    panelSnapshot: () => call("panelSnapshot"),
    taskDetail: (p) => call("taskDetail", p),
    taskSearch: (p) => call("taskSearch", p),
    todayTasks: () => call("todayTasks"),
    categoriesList: () => call("categoriesList"),
  };
}

/** 备份/导出命令门面（立即快照 + 列表 + 三种导出） */
function backupFacade(call: Sender): Pick<HostClient, "backupRun" | "backupList" | "exportRun"> {
  return {
    backupRun: () => call("backupRun"),
    backupList: () => call("backupList"),
    exportRun: (p) => call("exportRun", p),
  };
}

/** 由 transport 组装 HostClient（命令门面按域分组装配） */
export function createHostClient(transport: HostTransport): HostClient {
  const call: Sender = (command, params) => transport.send(command, params);
  const pageOpenListeners = new Set<(event: PageOpenEvent) => void>();
  transport.on("pageOpen", (event) => {
    for (const listener of pageOpenListeners) {
      listener(event);
    }
  });
  return {
    ...taskFacade(call),
    ...dispatchFacade(call),
    ...backpackFacade(call),
    ...miscFacade(call),
    ...backupFacade(call),
    onPageOpen(listener) {
      pageOpenListeners.add(listener);
      return () => {
        pageOpenListeners.delete(listener);
      };
    },
  };
}
