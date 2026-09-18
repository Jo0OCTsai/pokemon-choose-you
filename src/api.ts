import type {
  AgentSession,
  BackupInfo,
  BatchReviewResult,
  Category,
  ChatMessage,
  FeishuOauthStatus,
  IntegrationHealth,
  LogEntry,
  RemotePkReport,
  Tag,
  Task,
  TaskLog,
  TaskNote,
} from "./types";
import { i18n } from "./i18n";

/** 后端 AppError（src-tauri/src/error.rs）经 IPC 序列化后的结构 */
export type ApiErrorKind = "db" | "not_found" | "invalid" | "network" | "external" | "io" | "tauri";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly retryable: boolean;

  constructor(kind: ApiErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.retryable = retryable;
  }

  /** 统一归一化：Rust AppError 对象 / 旧式纯字符串 / IPC 传输层异常 → ApiError */
  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
      const shape = e as { kind: ApiErrorKind; message: string; retryable?: boolean };
      return new ApiError(shape.kind, shape.message ?? String(e), Boolean(shape.retryable));
    }
    if (typeof e === "string") {
      // 历史格式：无法判别类别，按外部错误处理（不可重试）
      return new ApiError("external", e, false);
    }
    // invoke 本身抛出的 JS 异常（webview 与后端断连等）按可重试网络错误处理
    return new ApiError("network", e instanceof Error ? e.message : String(e), true);
  }
}

/** 错误展示文案：图鉴机视角的轻前缀 + 保留技术原文（排障信息不盖住）。
 *  i18n 在此延迟取值调用（模块环 api→i18n→settings→api 无初始化期依赖，运行时安全） */
export function errorMessage(e: unknown): string {
  const raw = e instanceof ApiError ? e.message : ApiError.from(e).message;
  return `${i18n.global.t("error.prefix")}${raw}`;
}

/** 操作日志的来源标识：取调用窗口 label（main / pet），非 Tauri 环境为空 */
async function windowOrigin(): Promise<string> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label;
  } catch {
    return "";
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  // 后端命令按需声明 origin 参数（未声明的命令会忽略多余键）
  const origin = await windowOrigin();
  try {
    return await invoke<T>(cmd, { ...args, origin });
  } catch (e) {
    throw ApiError.from(e);
  }
}

export interface NewTaskInput {
  title: string;
  note?: string;
  categoryId?: number;
  priority?: string;
  dueAt?: string;
  remindAt?: string;
  scheduled?: boolean;
  tagIds?: number[];
}

export const api = {
  listTasks: (filter: string) => call<Task[]>("list_tasks", { filter }),
  dexStats: () => call<{ caught: number; escaped: number }>("dex_stats"),
  searchTasks: (q: string) => call<Task[]>("search_tasks", { q }),
  createTask: (task: NewTaskInput) => call<Task>("create_task", { task: { scheduled: false, ...task } }),
  updateTask: (patch: Partial<Task> & { id: number; tagIds?: number[] }) => call<Task>("update_task", { patch }),
  deleteTask: (id: number) => call<void>("delete_task", { id }),
  startTask: (id: number) => call<Task>("start_task", { id }),
  pauseCurrentTask: () => call<Task | null>("pause_current_task"),
  getCurrentTask: () => call<Task | null>("get_current_task"),
  addFocusSeconds: (id: number, seconds: number) => call<void>("add_focus_seconds", { id, seconds }),
  listTaskNotes: (taskId: number) => call<TaskNote[]>("list_task_notes", { taskId }),
  addTaskNote: (taskId: number, content: string) => call<TaskNote>("add_task_note", { taskId, content }),
  deleteTaskNote: (id: number) => call<void>("delete_task_note", { id }),
  listTaskLogs: (taskId: number) => call<TaskLog[]>("list_task_logs", { taskId }),
  listTags: () => call<Tag[]>("list_tags"),
  createTag: (name: string, description: string) => call<Tag>("create_tag", { name, description }),
  updateTag: (id: number, name: string, description: string) => call<void>("update_tag", { id, name, description }),
  deleteTag: (id: number) => call<void>("delete_tag", { id }),
  listCategories: () => call<Category[]>("list_categories"),
  setCategoryPokemon: (id: number, pokemon: string, sprite: string) =>
    call<void>("set_category_pokemon", { id, pokemon, sprite }),
  /** 停用/启用分类（停用后不进新建、编辑与 AI 选项，已有任务不受影响） */
  setCategoryEnabled: (id: number, enabled: boolean) => call<void>("set_category_enabled", { id, enabled }),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  listChatMessages: (query?: string) => call<ChatMessage[]>("list_chat_messages", { query: query ?? null }),
  acceptChatMessage: (id: number) => call<number>("accept_chat_message", { id }),
  /** 逃走（可选原因码落反馈库：duplicate/not_task/wrong_info/noise/outdated/other） */
  dismissChatMessage: (id: number, reasonCode?: string) =>
    call<void>("dismiss_chat_message", { id, reasonCode: reasonCode ?? null }),
  /** 强制用 AI 为消息创建待办（AI 先判重，重复则报错说明） */
  forceCreateTodo: (id: number) => call<number>("force_create_todo", { id }),
  /** 应用 AI 的更新建议：把建议字段打补丁到目标待办 */
  applyChatMessageUpdate: (id: number) => call<number>("apply_chat_message_update", { id }),
  /** 撤销最近一次分诊（5 秒撤销窗口）：逃走回 pending；捕捉删除刚建的待办 */
  undoChatReview: (id: number) => call<void>("undo_chat_review", { id }),
  /** 批量分诊：accept = 捕捉/应用更新，dismiss = 批量逃走（可带原因码）；单条失败不影响其余 */
  batchReviewChatMessages: (ids: number[], action: "accept" | "dismiss", reasonCode?: string) =>
    call<BatchReviewResult>("batch_review_chat_messages", {
      ids,
      action,
      reasonCode: reasonCode ?? null,
    }),
  /** 备份三件套：列表 / 立即备份 / 从备份恢复（恢复成功后广播全部数据变更事件） */
  listBackups: () => call<BackupInfo[]>("list_backups"),
  createBackupNow: () => call<string>("create_backup_now"),
  restoreBackup: (file: string) => call<void>("restore_backup", { file }),
  /** 导出/导入三件套：全量 JSON（可回导）/ 任务 CSV / 日报 Markdown；默认目录返回文件名，dest 自选路径返回全路径 */
  exportJson: (dest?: string) => call<string>("export_json", { dest: dest ?? null }),
  importJson: (content: string) => call<number>("import_json", { content }),
  exportTasksCsv: (dest?: string) => call<string>("export_tasks_csv", { dest: dest ?? null }),
  exportDailyMd: (date?: string, dest?: string) =>
    call<string>("export_daily_md", { date: date ?? null, dest: dest ?? null }),
  openExportsDir: () => call<void>("open_exports_dir"),
  listAllSettings: () => call<Record<string, string>>("list_all_settings"),
  openMainWindow: () => call<void>("open_main_window"),
  /** 主窗口挂载时领取"快速捕捉"挂起标记（一次性），返回 true 则直接聚焦新增输入框 */
  consumeQuickCapture: () => call<boolean>("consume_quick_capture"),
  /** 检查更新：返回新版本号，空串表示已是最新 */
  checkUpdate: () => call<string>("check_update"),
  /** 下载安装更新并重启 */
  installUpdate: () => call<void>("install_update"),
  /** 测试一个 AI agent（不传 id 用收音机分类使用的主 agent） */
  testAiConfig: (agentId?: string) => call<string>("test_ai_config", { agentId: agentId ?? null }),
  /** 在系统终端里打开 agent 的历史记录界面（agent 工具自己保存会话历史） */
  openAgentHistory: (agentId: string, sessionId?: string) =>
    call<string>("open_agent_history", { agentId, sessionId: sessionId ?? null }),
  /** 一键配置远程 pk：密钥/公钥/指纹/shim/PATH 全自动，成功写回隧道端口 */
  setupRemotePk: (agentId: string, port?: number) =>
    call<RemotePkReport>("setup_remote_pk", { agentId, port: port ?? null }),
  /** Agent 会话：taskId 查该任务时间线，缺省全局最近 100 条（含收音机分类调用） */
  listAgentSessions: (taskId?: number) => call<AgentSession[]>("list_agent_sessions", { taskId: taskId ?? null }),
  testFeishuConfig: () => call<string>("test_feishu_config"),
  triggerFeishuPoll: () => call<number>("trigger_feishu_poll"),
  /** 发起飞书用户授权：在系统终端里跑 lark-cli 登录（凭证由 lark-cli 保管） */
  feishuOauthLogin: () => call<string>("feishu_oauth_login"),
  /** 飞书授权状态（lark-cli 登录态：是否已登录 + 用户名） */
  feishuOauthStatus: () => call<FeishuOauthStatus>("feishu_oauth_status"),
  syncTodoist: () => call<string>("sync_todoist"),
  /** 集成健康汇总（飞书 / AI / Todoist） */
  getIntegrationHealth: () => call<IntegrationHealth[]>("integration_health"),
  /** 读取运行日志尾部（可按最低级别过滤） */
  listLogEntries: (tail?: number, minLevel?: string) =>
    call<LogEntry[]>("list_log_entries", { tail: tail ?? null, minLevel: minLevel ?? null }),
  /** 生成支持报告：版本 + 健康快照 + 最近日志（后端已脱敏） */
  buildSupportReport: () => call<string>("build_support_report"),
  createCategory: (name: string, pokemon: string, sprite: string) =>
    call<Category>("create_category", { name, pokemon, sprite }),
  updateCategory: (id: number, name: string, pokemon: string, sprite: string) =>
    call<void>("update_category", { id, name, pokemon, sprite }),
  deleteCategory: (id: number) => call<void>("delete_category", { id }),
};
