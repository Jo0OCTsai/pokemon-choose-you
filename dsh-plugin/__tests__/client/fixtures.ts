/**
 * 客户端组件测试公共夹具：PanelData 工厂 + 任务/消息构造器（对 mockHost 可测的纯组件层）。
 */
import type { Task } from "../../src/host/domain/tasks";
import type { Category } from "../../src/host/domain/vocabulary";
import type { RadioMessage } from "../../src/client/rpc";
import type { PanelData } from "../../src/client/model";

export function makeTask(overrides: Partial<Task> & { id: number }): Task {
  return {
    title: `任务 ${overrides.id}`,
    note: null,
    categoryId: 1,
    status: "inbox",
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-10-10T09:00:00+08:00",
    completedAt: null,
    startedAt: null,
    cancelledAt: null,
    focusSeconds: 0,
    tags: [],
    dispatchState: null,
    dispatchedSession: null,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> & { id: number }): Category {
  return {
    name: `分类${overrides.id}`,
    pokemon: "pikachu",
    sprite: "pokemon/pikachu.gif",
    enabled: true,
    description: "",
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<RadioMessage> & { messageId: string }): RadioMessage {
  return {
    content: "帮我看一下周报的数字",
    chatName: "产品群",
    senderName: "成员_1024",
    receivedAt: "2026-10-11T09:00:00+08:00",
    aiStatus: "todo",
    reviewStatus: "pending",
    suggestedTitle: "核对周报数字",
    suggestedNote: null,
    suggestedCategory: "工作",
    suggestedDue: null,
    suggestedPriority: null,
    suggestedTags: [],
    confidence: "high",
    reason: "明确动作指向",
    dismissReason: "",
    taskId: null,
    updateTaskId: null,
    ...overrides,
  };
}

export function makeData(overrides: Partial<PanelData> = {}): PanelData {
  return {
    locale: "zh-Hans",
    today: "2026-10-11",
    tasks: [],
    categories: [makeCategory({ id: 1, name: "工作" }), makeCategory({ id: 2, name: "生活", pokemon: "eevee" })],
    messages: [],
    health: {
      level: "ok",
      lastSuccessAt: "2026-10-11T08:00:00+08:00",
      nextPollAt: "2026-10-11T08:02:00+08:00",
      consecutiveFailures: 0,
      pendingCount: 0,
    },
    auth: { authorized: true, expired: false },
    followups: {},
    dispatches: {},
    sessions: [],
    routes: [],
    config: {
      language: "zh-Hans",
      pomodoro_enabled: "true",
      pomodoro_minutes: "25",
      break_minutes: "5",
      pomodoro_notify: "true",
      pomodoro_chime: "true",
      notifications_enabled: "true",
      remind_ahead_minutes: "0",
      quiet_hours_enabled: "true",
      quiet_start: "22:00",
      quiet_end: "08:00",
      reduce_motion: "false",
      overdue_mode: "collapse",
      date_format: "YYYY-MM-DD",
      time_format: "24h",
      due_relative: "true",
      close_to_tray: "true",
      backup_enabled: "true",
      backup_keep: "7",
      review_enabled: "true",
      review_dow: "1",
      main_pokemon: "",
      pokemon_quotes: "{}",
      pet_input_response: "false",
      pet_input_response_working: "false",
      pet_voice: "false",
      pet_mate: "false",
      feishu_poll_interval: "120",
      feishu_my_names: "",
      ai_agent_id: "",
      terminal_preference: "default",
      dispatch_auto_enabled: "false",
      dispatch_max_concurrent: "2",
      dispatch_worktree: "true",
      feishu_enabled: "false",
    },
    dbStatus: { userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "rw" },
    ...overrides,
  };
}
