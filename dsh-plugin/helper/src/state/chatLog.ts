/**
 * AI 聊聊纯逻辑（FR-A8，语义移植 composables/usePetChat 的状态机数值面）：
 * 问题 ≤200 字符（trim 后非空）、历史内存 3 条不持久化（新条目挤出最旧）。
 * 对话展开/收起与思考态由渲染层状态机承载；回答「截前 2 句」在 host 侧完成。
 */

export const CHAT_MAX_QUESTION = 200;
export const CHAT_HISTORY_MAX = 3;

export interface ChatEntry {
  role: "user" | "bot";
  text: string;
}

/** 追加并封顶（≤3 条，超出的最旧条目挤出——「历史内存 3 条」口径） */
export function pushChatEntry(log: readonly ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const next = [...log, entry];
  return next.length > CHAT_HISTORY_MAX ? next.slice(next.length - CHAT_HISTORY_MAX) : next;
}

/** 问题合法性：trim 后非空且 ≤200 字符 → 返回 trim 后文本；否则 null（输入行阻止提交） */
export function chatQuestion(raw: string): string | null {
  const q = (raw ?? "").trim();
  if (!q) return null;
  // 按码点计数（emoji 算一个字），对齐 ≤200 字符口径
  return [...q].length > CHAT_MAX_QUESTION ? null : q;
}
