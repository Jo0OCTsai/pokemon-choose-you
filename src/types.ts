export interface Task {
  id: number;
  title: string;
  note?: string | null;
  categoryId: number;
  /** inbox=草丛 / scheduled=路线 / active=进行中 / paused=暂停 / done=已完成 / cancelled=已逃走 */
  status: "inbox" | "scheduled" | "active" | "paused" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string | null;
  remindAt?: string | null;
  reminded: boolean;
  source: string;
  externalId?: string | null;
  createdAt: string;
  completedAt?: string | null;
  /** 首次出发时间；无截止时间且从未开始的任务归入草丛 */
  startedAt?: string | null;
  /** 逃走（取消）时间 */
  cancelledAt?: string | null;
  focusSeconds: number;
  /** 标签名列表（后端聚合返回） */
  tags: string[];
}

export interface Category {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  /** 停用后不出现在新建/编辑与 AI 分类选项中，已有任务不受影响 */
  enabled: boolean;
}

export interface Tag {
  id: number;
  name: string;
  description: string;
}

export interface TaskNote {
  id: number;
  taskId: number;
  content: string;
  source: "manual" | "ai" | string;
  createdAt: string;
}

/** 任务操作日志（后端 task_logs 表，编辑弹窗展示历史用） */
export interface TaskLog {
  id: number;
  taskId: number;
  /** create / update / start / pause / demote / delete / sync_pull / sync_push / sync_close / migrate */
  action: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  /** 变更来源：main / pet / radio / todoist / migration */
  origin: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  messageId: string;
  chatName: string;
  sender: string;
  content: string;
  /** 会话 id（同会话消息用于拼 AI 上下文）；老数据为空 */
  chatId?: string;
  /** p2p=单聊 / group=群聊 / bot=与机器人的单聊；老数据为空 */
  chatType?: string;
  /** 发送者 open_id（应用消息为应用 id） */
  senderId?: string;
  /** 消息发送时间（毫秒时间戳）；老数据为空 */
  sentAt?: number | null;
  /** 是否当前授权用户自己发的 */
  isSelf?: boolean;
  suggestedTitle?: string | null;
  suggestedCategory?: string | null;
  suggestedDue?: string | null;
  suggestedPriority?: string | null;
  suggestedNote?: string | null;
  suggestedTags: string[];
  /** pending / todo / none / followup / error */
  aiStatus: string;
  reviewStatus: "pending" | "accepted" | "dismissed";
  /** 该消息已创建的待办 id */
  taskId?: number | null;
  /** update 建议指向的目标待办 id（AI 判定消息是对该待办的变更） */
  updateTaskId?: number | null;
  createdAt: string;
}

/** 飞书用户授权状态（设置页展示） */
export interface FeishuOauthStatus {
  authorized: boolean;
  userName: string;
}

export interface AiLog {
  id: number;
  scene: string;
  model: string;
  requestBody: string;
  responseBody: string;
  ok: boolean;
  error?: string | null;
  durationMs: number;
  createdAt: string;
}

export function spriteUrl(sprite: string): string {
  // 优先动图，无动图则回退静态图（chansey 等没有官方动图）
  return `/pokemon/${sprite}.gif`;
}

export function spriteFallback(e: Event) {
  const el = e.target as HTMLImageElement;
  el.onerror = null;
  el.src = `/pokemon/${el.dataset.sprite}.png`;
}
