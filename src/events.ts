/**
 * 前后端事件契约（与 src-tauri/src/events.rs 一一对应）。
 * 两侧集合由各自的契约测试锁定（events.rs / events.spec.ts），改名须两侧同步。
 */
export const EVENTS = {
  tasksChanged: "tasks-changed",
  categoriesChanged: "categories-changed",
  settingsChanged: "settings-changed",
  /** 收音机电波（chat_messages）有新消息或状态变化 */
  chatMessagesChanged: "chat-messages-changed",
  /** 标签配置变化（设置页维护，两窗口跟随） */
  tagsChanged: "tags-changed",
  /** 提醒到期，payload: { id, title, urgent } */
  taskReminder: "task-reminder",
  /** 全局快捷键"快速捕捉待办"，前端聚焦新增输入框 */
  quickCapture: "quick-capture",
  /** 托盘"设置"菜单，前端切到设置页 */
  showSettings: "show-settings",
  /** 自动更新发现新版本，payload: 版本号字符串 */
  updateAvailable: "update-available",
  /** 更新包下载进度，payload: { downloaded, total }（字节） */
  updateProgress: "update-progress",
  /** 集成健康状态变化（飞书/AI/Todoist 链路的成功/失败记录），诊断页跟随刷新 */
  integrationHealthChanged: "integration-health-changed",
} as const;

export type AppEventName = (typeof EVENTS)[keyof typeof EVENTS];

export const ALL_EVENT_NAMES: AppEventName[] = Object.values(EVENTS);
