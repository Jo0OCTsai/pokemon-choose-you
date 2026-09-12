import type { Category, ImSuggestion, Task } from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
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
  createTask: (task: NewTaskInput) =>
    call<Task>("create_task", { task: { scheduled: false, ...task } }),
  updateTask: (patch: Partial<Task> & { id: number }) =>
    call<Task>("update_task", { patch }),
  deleteTask: (id: number) => call<void>("delete_task", { id }),
  startTask: (id: number) => call<Task>("start_task", { id }),
  pauseCurrentTask: () => call<Task | null>("pause_current_task"),
  getCurrentTask: () => call<Task | null>("get_current_task"),
  addFocusSeconds: (id: number, seconds: number) =>
    call<void>("add_focus_seconds", { id, seconds }),
  listCategories: () => call<Category[]>("list_categories"),
  setCategoryPokemon: (id: number, pokemon: string, sprite: string) =>
    call<void>("set_category_pokemon", { id, pokemon, sprite }),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  listImSuggestions: (status?: string) =>
    call<ImSuggestion[]>("list_im_suggestions", { status: status ?? null }),
  acceptImSuggestion: (id: number) => call<number>("accept_im_suggestion", { id }),
  dismissImSuggestion: (id: number) => call<void>("dismiss_im_suggestion", { id }),
  listAllSettings: () => call<Record<string, string>>("list_all_settings"),
  openMainWindow: () => call<void>("open_main_window"),
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
