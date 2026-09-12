export interface Task {
  id: number;
  title: string;
  note?: string | null;
  categoryId: number;
  status: "inbox" | "scheduled" | "active" | "paused" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string | null;
  remindAt?: string | null;
  reminded: boolean;
  source: string;
  externalId?: string | null;
  createdAt: string;
  completedAt?: string | null;
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

export interface ChatMessage {
  id: number;
  messageId: string;
  chatName: string;
  sender: string;
  content: string;
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
  createdAt: string;
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
