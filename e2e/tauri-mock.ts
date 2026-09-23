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
  status: "inbox" | "scheduled" | "active" | "paused" | "done" | "cancelled";
  priority: string;
  dueAt?: string | null;
  remindAt?: string | null;
  reminded: boolean;
  source: string;
  externalId?: string | null;
  createdAt: string;
  completedAt?: string | null;
  startedAt?: string | null;
  cancelledAt?: string | null;
  focusSeconds: number;
  tags: { name: string; dimension: string }[];
}

export interface MockCategory {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  enabled: boolean;
}

export interface MockState {
  windowLabel?: string;
  tasks: MockTask[];
  categories: MockCategory[];
  settings: Record<string, string>;
  /** 标签列表（缺省为空；project 标签可带 meta 供派发设置展示） */
  tags?: Record<string, unknown>[];
  /** 标签维度（缺省为内置四个；设置页维度管理会改写） */
  dimensions?: Record<string, unknown>[];
  /** 收音机电波消息（缺省为空；分诊语义与 Rust 侧对齐——原因随消息行落库） */
  chatMessages?: MockChatMessage[];
  /** 会话过滤总览种子（缺省为空表；行字段与 FeishuChatFilterView 对齐，合并语义镜像后端 filter_decision） */
  chatFilter?: MockChatFilterView[];
  /** 会话过滤快照时间（缺省 = 当前时间；显式 null = 从未成功拉取空态） */
  chatFilterSnapshotAt?: string | null;
}

export interface MockChatFilterView {
  chatId: string;
  chatName: string;
  /** group / p2p / bot */
  chatType: string;
  /** muted / unmuted / unknown */
  muteOutcome: string;
  /** follow / always_filter / always_pull */
  preference: string;
  /** pull / filter（派生，不落库） */
  effective: string;
  /** manual / follow / followDegraded */
  source: string;
  updatedAt: string;
}

export function chatFilter(
  partial: Partial<MockChatFilterView> & { chatId: string; chatName: string },
): MockChatFilterView {
  return {
    chatType: "group",
    muteOutcome: "unmuted",
    preference: "follow",
    effective: "pull",
    source: "follow",
    updatedAt: "2026-09-23T08:00:00Z",
    ...partial,
  };
}

export interface MockChatMessage {
  id: number;
  messageId: string;
  chatName: string;
  sender: string;
  content: string;
  chatId?: string;
  chatType?: string;
  suggestedTitle?: string | null;
  suggestedTags: { name: string; dimension: string; isNew?: boolean }[];
  suggestedReason?: string | null;
  suggestedConfidence?: string | null;
  /** pending / todo / none / update / followup / error */
  aiStatus: string;
  /** pending / accepted / dismissed */
  reviewStatus: string;
  taskId?: number | null;
  updateTaskId?: number | null;
  dismissReason?: string;
  createdAt: string;
}

export function chatMessage(partial: Partial<MockChatMessage> & { id: number; content: string }): MockChatMessage {
  return {
    messageId: `m${partial.id}`,
    chatName: "项目群",
    sender: "张三",
    suggestedTitle: null,
    suggestedTags: [],
    suggestedReason: null,
    suggestedConfidence: null,
    aiStatus: "todo",
    reviewStatus: "pending",
    taskId: null,
    createdAt: "2026-09-11T00:00:00Z",
    ...partial,
  };
}

export const DEFAULT_CATEGORIES: MockCategory[] = [
  { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu", enabled: true },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck", enabled: true },
  { id: 3, name: "生活", pokemon: "妙蛙种子", sprite: "bulbasaur", enabled: true },
  { id: 4, name: "健康", pokemon: "吉利蛋", sprite: "chansey", enabled: true },
  { id: 5, name: "兴趣", pokemon: "伊布", sprite: "eevee", enabled: true },
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
    startedAt: null,
    cancelledAt: null,
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
      const db = {
        ...st,
        tags: st.tags ?? [],
        chatMessages: st.chatMessages ?? [],
        chatFilter: st.chatFilter ?? [],
        // 与 Rust 侧迁移内置的四个维度一致；注入函数被序列化进浏览器，缺省值必须在函数体内
        dimensions:
          st.dimensions ??
          [
            { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 20, sort: 1, enabled: true },
            { id: 2, key: "context", name: "场景", cardinality: "multi", maxTags: 10, sort: 2, enabled: true },
            { id: 3, key: "person", name: "人物", cardinality: "multi", maxTags: 30, sort: 3, enabled: true },
            { id: 4, key: "topic", name: "主题", cardinality: "multi", maxTags: 30, sort: 4, enabled: true },
          ].map((d) => ({ ...d })),
        nextId: st.tasks.reduce((m: number, t: { id: number }) => Math.max(m, t.id), 0) + 1,
        nextDimId: 5,
      };
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
            if (filter === "done")
              return db.tasks.filter((t) => t.status === "done" || t.status === "cancelled").map((t) => ({ ...t }));
            if (filter === "open")
              return fresh().filter((t) => ["inbox", "scheduled", "active", "paused"].includes(t.status));
            return fresh();
          }
          case "dex_stats": {
            const caught = db.tasks.filter((t) => t.status === "done").length;
            const escaped = db.tasks.filter((t) => t.status === "cancelled").length;
            const sprites = [
              ...new Set(
                db.tasks
                  .filter((t) => t.status === "done")
                  .map((t) => db.categories.find((c) => c.id === t.categoryId)?.sprite)
                  .filter(Boolean),
              ),
            ];
            return { caught, escaped, sprites };
          }
          case "task_streak": {
            // 简化口径：今天 + 连续往前数有 done 的天数（不做宽容日，e2e 只断言形态）
            const day = (iso: string) => iso.slice(0, 10);
            const done = new Set(
              db.tasks.filter((t) => t.status === "done" && t.completedAt).map((t) => day(t.completedAt!)),
            );
            const today = day(nowIso());
            let days = 0;
            const cur = new Date(today + "T00:00:00");
            for (let i = 0; i < 400; i++) {
              const key = day(cur.toISOString());
              if (done.has(key)) days++;
              else if (i > 0) break;
              cur.setDate(cur.getDate() - 1);
            }
            const todayCount = db.tasks.filter(
              (t) => t.status === "done" && t.completedAt && day(t.completedAt) === today,
            ).length;
            return { days, todayCount };
          }
          case "pet_chat":
            return "剩 2 只：周报、给妈妈买礼物 🐾";
          case "pet_speak":
            return null;
          case "pet_input_set_enabled":
            return "ok";
          case "pet_input_permission":
            return true;
          case "pet_input_exe":
            return "/mock/path/pokemon-choose-you";
          case "pet_input_grant":
            return null;
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
            if (args.patch.status === "cancelled" && !t.cancelledAt) t.cancelledAt = nowIso();
            // 状态不变量：无截止时间且从未开始 → 草丛
            if (t.status === "scheduled" && t.dueAt == null && t.startedAt == null) t.status = "inbox";
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
            if (!t.startedAt) t.startedAt = nowIso();
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
            const c = { id: db.categories.length + 1, enabled: true, ...args };
            db.categories.push(c);
            broadcast("categories-changed");
            return c;
          }
          case "set_category_enabled": {
            const c = db.categories.find((x) => x.id === args.id);
            if (c) c.enabled = args.enabled;
            broadcast("categories-changed");
            return null;
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
          case "list_backups":
            return [
              {
                file: "pokemon-choose-you-20260901-080000.db",
                size: 16384,
                createdAt: "2026-09-01T08:00:00+08:00",
              },
            ];
          case "create_backup_now":
            return "pokemon-choose-you-20260913-120000.db";
          case "export_json":
            return "pokemon-choose-you-full-mock.json";
          case "import_json":
            broadcast("tasks-changed");
            broadcast("settings-changed");
            return 0;
          case "export_tasks_csv":
            return "pokemon-choose-you-tasks-mock.csv";
          case "export_daily_md":
            return "pokemon-choose-you-daily-mock.md";
          case "open_exports_dir":
            return null;
          case "restore_backup":
            broadcast("tasks-changed");
            broadcast("categories-changed");
            broadcast("settings-changed");
            return null;
          case "list_im_suggestions":
          case "list_chat_messages":
            return db.chatMessages.map((m: any) => ({ ...m }));
          case "accept_im_suggestion":
          case "accept_chat_message":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return db.nextId++;
          case "dismiss_im_suggestion":
          case "dismiss_chat_message": {
            // 与 Rust 侧同口径：逃走翻转 review_status，原因码随消息行落库
            const msg = db.chatMessages.find((m: any) => m.id === args.id);
            if (msg) {
              msg.reviewStatus = "dismissed";
              msg.dismissReason = args.reasonCode ?? "";
            }
            broadcast("chat-messages-changed");
            return null;
          }
          case "force_create_todo":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return db.nextId++;
          case "capture_todo": {
            // 模拟 AI 判定为 todo 并自动建待办（真实判重/属性逻辑由 cargo test 覆盖）
            const id = db.nextId++;
            const t = {
              id,
              title: args.input,
              note: null,
              categoryId: 1,
              status: "inbox",
              priority: "normal",
              dueAt: null,
              remindAt: null,
              reminded: false,
              source: "capture",
              externalId: null,
              focusSeconds: 0,
              completedAt: null,
              createdAt: nowIso(),
              tags: [],
            };
            db.tasks.push(t);
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return {
              message: {
                id: 9001,
                messageId: `cap_${id}`,
                chatName: "",
                chatType: "local",
                sender: "我",
                content: args.input,
                suggestedTitle: args.input,
                suggestedTags: [],
                aiStatus: "todo",
                reviewStatus: "accepted",
                taskId: id,
                createdAt: nowIso(),
              },
              taskId: id,
            };
          }
          case "list_tags":
            return db.tags.map((t: any) => ({ ...t, meta: t.meta ? { ...t.meta } : null }));
          case "create_tag": {
            const tag = {
              id: db.nextId++,
              name: args.name,
              description: args.description ?? "",
              dimension: args.dimension ?? "topic",
              origin: "manual",
              usage: 0,
              createdAt: nowIso(),
              meta: null,
            };
            db.tags.push(tag);
            broadcast("tags-changed");
            return { ...tag };
          }
          case "update_tag": {
            const tag = db.tags.find((t: any) => t.id === args.id);
            if (!tag) throw new Error(`标签 ${args.id} 不存在`);
            const name = String(args.name ?? "").trim();
            if (!name) throw new Error("标签名不能为空");
            tag.name = name;
            tag.description = args.description ?? "";
            if (args.dimension) tag.dimension = args.dimension;
            broadcast("tags-changed");
            return null;
          }
          case "delete_tag": {
            // 任务上的关联随删除清理（对齐 Rust 侧 task_tags 级联）
            const dead = db.tags.find((t: any) => t.id === args.id);
            db.tags = db.tags.filter((t: any) => t.id !== args.id);
            if (dead) {
              db.tasks.forEach((t) => {
                t.tags = t.tags.filter(
                  (r) => !(r.name === dead.name && (r.dimension || "topic") === (dead.dimension || "topic")),
                );
              });
            }
            broadcast("tags-changed");
            broadcast("tasks-changed");
            return null;
          }
          case "tag_checkup":
            return { merges: [], zombies: [], newDimensions: [], judged: false };
          case "merge_tag":
            broadcast("tags-changed");
            broadcast("tasks-changed");
            return null;
          case "move_tags_to_dimension":
            broadcast("tags-changed");
            broadcast("tasks-changed");
            return null;
          case "list_tag_dimensions":
            return db.dimensions.map((d: any) => ({ ...d }));
          case "create_tag_dimension": {
            // 与 Rust 侧对齐：key 小写 ascii、cardinality 缺省 single、上限缺省 20（1~200）
            const key = String(args.key ?? "")
              .trim()
              .toLowerCase();
            const name = String(args.name ?? "").trim();
            if (!key || !name) throw new Error("维度 key 与名称不能为空");
            if (!/^[a-z0-9_-]+$/.test(key)) throw new Error("维度 key 只能包含小写字母、数字、-、_");
            const dim = {
              id: db.nextDimId++,
              key,
              name,
              cardinality: args.cardinality == null ? "single" : String(args.cardinality),
              maxTags: args.maxTags == null ? 20 : Math.min(200, Math.max(1, Number(args.maxTags))),
              sort: db.dimensions.length + 1,
              enabled: true,
            };
            db.dimensions.push(dim);
            broadcast("tags-changed");
            return { ...dim };
          }
          case "update_tag_dimension": {
            const dim = db.dimensions.find((d: any) => d.id === args.id);
            if (!dim) throw new Error(`维度 ${args.id} 不存在`);
            const name = String(args.name ?? "").trim();
            if (!name) throw new Error("维度名称不能为空");
            dim.name = name;
            if (args.maxTags != null) dim.maxTags = Math.min(200, Math.max(1, Number(args.maxTags)));
            if (args.enabled != null) dim.enabled = Boolean(args.enabled);
            broadcast("tags-changed");
            return null;
          }
          case "search_tasks":
            return db.tasks.filter((t: any) => (t.title ?? "").includes(args.q)).map((t: any) => ({ ...t }));
          case "list_agent_sessions":
            return [];
          case "log_agent_session":
            return null;
          case "list_task_notes":
            return [];
          case "list_task_logs":
            return [];
          case "add_task_note":
          case "delete_task_note":
            broadcast("tasks-changed");
            return null;
          case "open_agent_history":
            return "已在 mock 终端中启动（E2E mock）";
          // ---- Agent 派发（M1）：解析跟随 ai_agents 设置；派发返回固定成功载荷 ----
          case "resolve_task_dispatch": {
            const t = db.tasks.find((x: any) => x.id === args.taskId);
            const project = (t?.tags ?? []).find((r: any) => r.dimension === "project");
            // 标签 meta（db.tags 里同名 project 标签）：agentId 指定优先、workdir/context 透传
            const meta = project
              ? ((db.tags.find((g: any) => g.name === project.name && g.dimension === "project")?.meta ?? null) as any)
              : null;
            let enabled: any[] = [];
            try {
              enabled = JSON.parse(db.settings.ai_agents ?? "[]").filter((a: any) => a.enabled);
            } catch {
              enabled = [];
            }
            const metaAgent = meta?.agentId ? enabled.find((a: any) => a.id === meta.agentId) : null;
            const agent = metaAgent ?? enabled.find((a: any) => a.id === db.settings.ai_agent_id) ?? enabled[0] ?? null;
            return {
              taskId: args.taskId,
              hasProjectTag: !!project,
              projectTag: project ? project.name : null,
              source: metaAgent ? "tag" : agent ? "default" : "",
              agentId: agent ? agent.id : null,
              agentName: agent ? agent.name : null,
              sshHost: agent?.remote?.host ?? null,
              workdir: meta?.workdir ?? "",
              context: meta?.context ?? null,
              agents: enabled.map((a: any) => ({ id: a.id, name: a.name, sshHost: a.remote?.host ?? null })),
            };
          }
          case "dispatch_task": {
            const headless = args.channel === "headless";
            return {
              channel: headless ? "headless" : "interactive",
              terminal: headless ? null : "Terminal",
              note: null,
              state: headless ? "done" : "running",
              session: {
                id: db.nextId++,
                taskId: args.taskId,
                agentId: args.agentId ?? "mock-agent",
                agentName: "Mock Agent",
                sessionId: `pk-${args.taskId}`,
                command: "claude '处理这条待办…'（E2E mock）",
                exitCode: headless ? 0 : null,
                status: "ok",
                durationMs: headless ? 12_000 : null,
                costUsd: headless ? 0.05 : null,
                inputTokens: null,
                outputTokens: null,
                createdAt: nowIso(),
              },
            };
          }
          case "mark_dispatch":
            broadcast("tasks-changed");
            return null;
          case "set_tag_meta": {
            const tag = db.tags.find((t: any) => t.id === args.id);
            if (tag) tag.meta = args.meta ?? null;
            broadcast("tags-changed");
            return null;
          }
          case "test_ai_config":
            return "Agent 调用成功（E2E mock）";
          case "test_feishu_config":
            return "连接成功，已授权「测试用户」，可见 3 个会话（E2E mock）";
          case "trigger_feishu_poll":
            return 0;
          case "apply_chat_message_update":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return 1;
          case "batch_review_chat_messages":
            broadcast("tasks-changed");
            broadcast("chat-messages-changed");
            return { ok: (args.ids ?? []).length, failed: [] };
          case "integration_health":
            return [
              {
                provider: "feishu",
                configured: true,
                enabled: true,
                status: "ok",
                lastSuccessAt: "2026-09-12T08:00:00Z",
                lastError: null,
                lastErrorAt: null,
                consecutiveFailures: 0,
                nextPollAt: Date.now() + 60_000,
                pendingCount: 0,
                primaryAgent: "",
              },
              {
                provider: "ai",
                configured: true,
                enabled: true,
                status: "ok",
                lastSuccessAt: "2026-09-12T08:00:00Z",
                lastError: null,
                lastErrorAt: null,
                consecutiveFailures: 0,
                nextPollAt: null,
                pendingCount: 0,
                primaryAgent: "Claude Code",
              },
            ];
          case "list_log_entries":
            return [
              {
                time: "2026-09-12 08:00:00",
                level: "info",
                target: "app_lib",
                message: "db migrated to v8（E2E mock）",
              },
            ];
          case "build_support_report":
            return "就决定是你了 支持报告（E2E mock）";
          case "feishu_oauth_login":
            return "授权成功：测试用户（E2E mock）";
          case "feishu_oauth_status":
            return { authorized: true, userName: "测试用户" };
          // ---- 会话过滤（合并规则镜像后端 filter_decision；set 后广播事件供两窗口重拉） ----
          case "get_feishu_chat_filter_overview": {
            const chats = db.chatFilter.map((c: any) => ({ ...c }));
            const pulling = chats.filter((c: any) => c.effective === "pull").length;
            const manual = chats.filter((c: any) => c.preference !== "follow").length;
            return {
              chats,
              counts: { total: chats.length, pulling, filtered: chats.length - pulling, manual },
              snapshotAt: db.chatFilterSnapshotAt === undefined ? nowIso() : db.chatFilterSnapshotAt,
            };
          }
          case "set_feishu_chat_filter": {
            if (!["follow", "always_filter", "always_pull"].includes(args.preference))
              throw new Error(`非法 preference：${args.preference}`);
            const row = db.chatFilter.find((c: any) => c.chatId === args.chatId);
            if (!row) throw new Error(`会话不存在：${args.chatId}`);
            row.preference = args.preference;
            if (args.preference === "always_filter") {
              row.effective = "filter";
              row.source = "manual";
            } else if (args.preference === "always_pull") {
              row.effective = "pull";
              row.source = "manual";
            } else if (row.muteOutcome === "muted") {
              row.effective = "filter";
              row.source = "follow";
            } else if (row.muteOutcome === "unknown") {
              row.effective = "pull";
              row.source = "followDegraded";
            } else {
              row.effective = "pull";
              row.source = "follow";
            }
            row.updatedAt = nowIso();
            broadcast("feishu-chat-filter-changed");
            return { ...row };
          }
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
