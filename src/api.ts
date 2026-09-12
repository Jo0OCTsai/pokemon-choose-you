import type { Category, ImSuggestion, Task } from "./types";

/** 后端 AppError（src-tauri/src/error.rs）经 IPC 序列化后的结构 */
export type ApiErrorKind = "db" | "not_found" | "invalid" | "network" | "external" | "io";

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
}

export const api = {
  listTasks: (filter: string) => call<Task[]>("list_tasks", { filter }),
  createTask: (task: NewTaskInput) => call<Task>("create_task", { task: { scheduled: false, ...task } }),
  updateTask: (patch: Partial<Task> & { id: number }) => call<Task>("update_task", { patch }),
  deleteTask: (id: number) => call<void>("delete_task", { id }),
  startTask: (id: number) => call<Task>("start_task", { id }),
  pauseCurrentTask: () => call<Task | null>("pause_current_task"),
  getCurrentTask: () => call<Task | null>("get_current_task"),
  addFocusSeconds: (id: number, seconds: number) => call<void>("add_focus_seconds", { id, seconds }),
  listCategories: () => call<Category[]>("list_categories"),
  setCategoryPokemon: (id: number, pokemon: string, sprite: string) =>
    call<void>("set_category_pokemon", { id, pokemon, sprite }),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  listImSuggestions: (status?: string) => call<ImSuggestion[]>("list_im_suggestions", { status: status ?? null }),
  acceptImSuggestion: (id: number) => call<number>("accept_im_suggestion", { id }),
  dismissImSuggestion: (id: number) => call<void>("dismiss_im_suggestion", { id }),
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
