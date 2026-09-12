import type { AiLog, Category, ChatMessage, Tag, Task, TaskNote } from "./types";

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

/** 错误展示文案：直接用归一化后的 message */
export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : ApiError.from(e).message;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
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
  dismissChatMessage: (id: number) => call<void>("dismiss_chat_message", { id }),
  /** 强制用 AI 为消息创建待办（AI 先判重，重复则报错说明） */
  forceCreateTodo: (id: number) => call<number>("force_create_todo", { id }),
  listAiLogs: (limit?: number) => call<AiLog[]>("list_ai_logs", { limit: limit ?? null }),
  clearAiLogs: () => call<void>("clear_ai_logs"),
  listAllSettings: () => call<Record<string, string>>("list_all_settings"),
  openMainWindow: () => call<void>("open_main_window"),
  /** 主窗口挂载时领取"快速捕捉"挂起标记（一次性），返回 true 则直接聚焦新增输入框 */
  consumeQuickCapture: () => call<boolean>("consume_quick_capture"),
  /** 检查更新：返回新版本号，空串表示已是最新 */
  checkUpdate: () => call<string>("check_update"),
  /** 下载安装更新并重启 */
  installUpdate: () => call<void>("install_update"),
  testAiConfig: () => call<string>("test_ai_config"),
  testFeishuConfig: () => call<string>("test_feishu_config"),
  triggerFeishuPoll: () => call<number>("trigger_feishu_poll"),
  syncTodoist: () => call<string>("sync_todoist"),
  createCategory: (name: string, pokemon: string, sprite: string) =>
    call<Category>("create_category", { name, pokemon, sprite }),
  updateCategory: (id: number, name: string, pokemon: string, sprite: string) =>
    call<void>("update_category", { id, name, pokemon, sprite }),
  deleteCategory: (id: number) => call<void>("delete_category", { id }),
};
