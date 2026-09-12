import type { Page } from "@playwright/test";

/**
 * 浏览器环境里替代 Tauri IPC：在页面加载前注入 window.__TAURI_INTERNALS__，
 * 用内存实现所有后端命令（与 Rust 侧语义对齐：camelCase 载荷、过滤规则、专注模式唯一 active）。
 * 真实的 Rust 命令逻辑由 cargo test 覆盖，这里验证前端两窗口的完整用户流程。
 */
export interface MockTask {
  id: number;
  title: string;
  note?: string | null;
  categoryId: number;
  status: "inbox" | "scheduled" | "active" | "paused" | "done";
  priority: string;
  dueAt?: string | null;
  remindAt?: string | null;
  reminded: boolean;
  source: string;
  externalId?: string | null;
  createdAt: string;
  completedAt?: string | null;
  focusSeconds: number;
  tags: string[];
}

export interface MockCategory {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
}

export interface MockState {
  windowLabel?: string;
  tasks: MockTask[];
  categories: MockCategory[];
  settings: Record<string, string>;
}

export const DEFAULT_CATEGORIES: MockCategory[] = [
  { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu" },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck" },
  { id: 3, name: "生活", pokemon: "妙蛙种子", sprite: "bulbasaur" },
  { id: 4, name: "健康", pokemon: "吉利蛋", sprite: "chansey" },
  { id: 5, name: "社交", pokemon: "伊布", sprite: "eevee" },
  { id: 6, name: "紧急", pokemon: "卡比兽", sprite: "snorlax" },
];

export function task(partial: Partial<MockTask> & { id: number; title: string }): MockTask {
  return {
    note: null,
    categoryId: 1,
    status: "inbox",
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-10T08:00:00Z",
    completedAt: null,
    focusSeconds: 0,
    tags: [],
    ...partial,
  };
}

/** 注入 mock 后返回控制句柄：读取当前后端状态、触发 Tauri 事件 */
export async function installTauriMock(page: Page, state: Partial<MockState> = {}) {
  const full: MockState = {
    windowLabel: "main",
    tasks: [],
    categories: DEFAULT_CATEGORIES,
    settings: {},
    ...state,
  };
  await page.addInitScript(
    (st) => {
      const db = { ...st, nextId: st.tasks.reduce((m: number, t: { id: number }) => Math.max(m, t.id), 0) + 1 };
      let cbId = 0;

      // 事件监听注册表：数据变更命令后模拟后端广播（与 Rust 侧 broadcast 对齐）
      const eventListeners: Array<{ event: string; handler: number }> = [];
      function broadcast(event: string, payload: unknown = null) {
        eventListeners
          .filter((l) => l.event === event)
          .forEach((l) => {
            const cb = (window as any)[`_${l.handler}`];
            if (typeof cb === "function") cb({ event, id: 0, payload });
          });
      }

      function nowIso() {
        return new Date().toISOString();
      }

      async function invoke(cmd: string, args: Record<string, any> = {}): Promise<any> {
        switch (cmd) {
          case "list_tasks": {
            const filter = args.filter;
            // 真实 IPC 每次都返回反序列化的新对象；深拷贝避免前端拿到与 db 同引用的
            // 对象（原地变更后引用不变会让子组件的 props 更新被 Vue 跳过）
            const fresh = () => db.tasks.map((t: any) => ({ ...t }));
            if (filter === "done") return db.tasks.filter((t) => t.status === "done").map((t) => ({ ...t }));
            if (filter === "open")
              return fresh().filter((t) => ["inbox", "scheduled", "active", "paused"].includes(t.status));
            return fresh();
          }
          case "create_task": {
            const t = {
              id: db.nextId++,
              note: null,
              categoryId: 1,
              priority: "normal",
              dueAt: null,
              remindAt: null,
              reminded: false,
              source: "local",
              externalId: null,
              focusSeconds: 0,
              completedAt: null,
              createdAt: nowIso(),
              tags: [],
              status: args.task.scheduled ? "scheduled" : "inbox",
              ...args.task,
            };
            db.tasks.push(t);
            broadcast("tasks-changed");
            return t;
          }
          case "update_task": {
            const t = db.tasks.find((x) => x.id === args.patch.id);
            if (!t) throw new Error(`no task ${args.patch.id}`);
            Object.assign(t, args.patch);
            if (args.patch.status === "done" && !t.completedAt) t.completedAt = nowIso();
            broadcast("tasks-changed");
            return t;
          }
          case "delete_task":
            db.tasks = db.tasks.filter((t) => t.id !== args.id);
            broadcast("tasks-changed");
            return null;
          case "start_task": {
            db.tasks.forEach((t) => {
              if (t.status === "active" || t.status === "paused") t.status = "scheduled";
            });
            const t = db.tasks.find((x) => x.id === args.id)!;
            t.status = "active";
            broadcast("tasks-changed");
            return t;
          }
          case "pause_current_task": {
            db.tasks.forEach((t) => {
              if (t.status === "active") t.status = "paused";
            });
            broadcast("tasks-changed");
            const paused = db.tasks.find((t) => t.status === "paused");
            return paused ? { ...paused } : null;
          }
          case "get_current_task": {
            const active = db.tasks.find((t) => t.status === "active");
            return active ? { ...active } : null;
          }
          case "add_focus_seconds": {
            const t = db.tasks.find((x) => x.id === args.id);
            if (t) t.focusSeconds += args.seconds;
            return null;
          }
          case "list_categories":
            return db.categories;
          case "set_category_pokemon": {
            const c = db.categories.find((x) => x.id === args.id);
            if (c) {
              c.pokemon = args.pokemon;
              c.sprite = args.sprite;
            }
            broadcast("categories-changed");
            return null;
          }
          case "create_category": {
            const c = { id: db.categories.length + 1, ...args };
            db.categories.push(c);
            broadcast("categories-changed");
            return c;
          }
          case "update_category": {
            const c = db.categories.find((x) => x.id === args.id);
            if (c) Object.assign(c, { name: args.name, pokemon: args.pokemon, sprite: args.sprite });
            broadcast("categories-changed");
            return null;
          }
          case "delete_category": {
            if (db.categories.length <= 1) throw new Error("至少保留一个分类");
            const fallback = db.categories.find((c) => c.id !== args.id)!;
            db.tasks.forEach((t) => {
              if (t.categoryId === args.id) t.categoryId = fallback.id;
            });
            db.categories = db.categories.filter((c) => c.id !== args.id);
            broadcast("categories-changed");
            broadcast("tasks-changed");
            return null;
          }
          case "open_main_window":
            // 记录调用供 e2e 断言（真实后端里这个命令会置前/重建主窗口）
            (window as any).__mainOpened = ((window as any).__mainOpened ?? 0) + 1;
            return null;
          case "consume_quick_capture":
            return false;
          case "check_update":
            return "";
          case "install_update":
            return null;
          case "plugin:app|version":
            return "0.1.0 (E2E mock)";
          case "get_setting":
            return db.settings[args.key] ?? null;
          case "set_setting":
            db.settings[args.key] = args.value;
            broadcast("settings-changed");
            return null;
          case "list_all_settings":
            return { ...db.settings };
          case "list_im_suggestions":
          case "list_chat_messages":
            return [];
          case "accept_im_suggestion":
          case "accept_chat_message":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return db.nextId++;
          case "dismiss_im_suggestion":
          case "dismiss_chat_message":
            broadcast("chat-messages-changed");
            return null;
          case "force_create_todo":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return db.nextId++;
          case "list_tags":
            return [];
          case "search_tasks":
            return db.tasks.filter((t: any) => (t.title ?? "").includes(args.q)).map((t: any) => ({ ...t }));
          case "list_task_notes":
            return [];
          case "add_task_note":
          case "delete_task_note":
            broadcast("tasks-changed");
            return null;
          case "list_ai_logs":
            return [];
          case "clear_ai_logs":
            return null;
          case "test_ai_config":
            return "连接成功（E2E mock）";
          case "test_feishu_config":
            return "连接成功，机器人在 3 个会话中（E2E mock）";
          case "trigger_feishu_poll":
            return 0;
          case "sync_todoist":
            return "同步完成（E2E mock）";
          // ---- 插件 ----
          case "plugin:autostart|isEnabled":
            return false;
          case "plugin:autostart|enable":
          case "plugin:autostart|disable":
            return null;
          case "plugin:event|listen":
            eventListeners.push({ event: args.event, handler: args.handler });
            return ++cbId;
          case "plugin:event|unlisten":
            return null;
          case "plugin:notification|is_permission_granted":
            return true;
          case "plugin:notification|request_permission":
            return "granted";
          case "plugin:notification|notify":
            return null;
          case "plugin:window|get_all_windows":
            return [];
          case "plugin:window|set_size":
          case "plugin:window|set_focus":
          case "plugin:window|show":
          case "plugin:window|start_dragging":
            return null;
          default:
            throw new Error(`E2E mock: 未实现的命令 ${cmd}`);
        }
      }

      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: db.windowLabel },
          currentWebview: { label: db.windowLabel },
        },
        invoke,
        transformCallback(callback: () => void) {
          const id = ++cbId;
          Object.defineProperty(window, `_${id}`, { value: callback, configurable: true });
          return id;
        },
        unregisterCallback(id: number) {
          delete (window as any)[`_${id}`];
        },
        convertFileSrc: (filePath: string) => filePath,
        plugins: {},
      };
    },
    JSON.parse(JSON.stringify(full)) as any,
  );
}
