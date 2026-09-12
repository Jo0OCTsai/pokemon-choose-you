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
}

export interface Category {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
}

export interface ImSuggestion {
  id: number;
  messageId: string;
  chatName: string;
  sender: string;
  content: string;
  suggestedTitle?: string | null;
  suggestedCategory?: string | null;
  suggestedDue?: string | null;
  reviewStatus: "pending" | "accepted" | "dismissed";
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
