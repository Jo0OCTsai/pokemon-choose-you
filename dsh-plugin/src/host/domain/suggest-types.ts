/**
 * 判定协议类型（contracts/PROTOCOL.md §3）：AiSuggestion / ProposedTag——与
 * src-tauri/src/ai/types.rs 逐字段对应（camelCase）；兼容旧协议纯字符串标签形态。
 */
import { paramError } from "../storage/errors";

/** AI 建议标签：名字 + 归属维度 + 是否词表外新建 */
export interface ProposedTag {
  name: string;
  /** 缺省 topic */
  dimension?: string;
  isNew?: boolean;
}

/** 判定协议载荷（PROTOCOL.md §3 JSON Schema） */
export interface AiSuggestion {
  messageId: string;
  action: string; // todo | update | followUp | none（提交期封闭校验）
  title?: string | null;
  note?: string | null;
  category?: string | null;
  priority?: string | null;
  /** 空串/纯空白在接受期归一 NULL */
  due?: string | null;
  tags?: ProposedTag[];
  followUpTaskId?: number | null;
  updateTaskId?: number | null;
  reason?: string | null;
  confidence?: string | null;
}

export function isTodo(s: AiSuggestion): boolean {
  return s.action === "todo";
}

export function isUpdate(s: AiSuggestion): boolean {
  return s.action === "update";
}

export function isFollowUp(s: AiSuggestion): boolean {
  return s.action === "followUp";
}

/** 兼容旧纯字符串形态（ProposedTag 反序列化同构：字符串 → {name, dimension:topic, isNew:false}） */
export function normalizeProposedTag(tag: ProposedTag | string): ProposedTag {
  if (typeof tag === "string") {
    return { name: tag, dimension: "topic", isNew: false };
  }
  const dimension = (tag.dimension ?? "topic").trim();
  return {
    name: tag.name.trim(),
    dimension: dimension === "" ? "topic" : dimension,
    isNew: tag.isNew ?? false,
  };
}

/** 分诊/捕捉路径消费的消息视图（chat_messages 建议列的 camelCase 投影） */
export interface ChatMessageLike {
  id: number;
  messageId: string;
  content: string;
  suggestedTitle: string | null;
  suggestedNote: string | null;
  suggestedCategory: string | null;
  suggestedDue: string | null;
  suggestedPriority: string | null;
  suggestedTags: string; // JSON
  aiStatus: string;
  reviewStatus: string;
  taskId: number | null;
  updateTaskId: number | null;
  followupTaskId: number | null;
  aiAgent: string;
  dismissReason: string;
  chatType: string;
}

/** 逃走原因码白名单（radio/suggest.rs ESCAPE_REASONS，6 枚举） */
export const ESCAPE_REASONS = [
  "duplicate", // 已有类似待办
  "not_task", // 不是给我的任务
  "wrong_info", // 建议内容不对（标题/时间/分类错了）
  "noise", // 闲聊/噪音
  "outdated", // 已过期
  "other", // 其他
] as const;

export function validEscapeReason(code: string | null | undefined): string {
  if (code === null || code === undefined) {
    return "";
  }
  if (!ESCAPE_REASONS.includes(code as (typeof ESCAPE_REASONS)[number])) {
    throw paramError(`未知逃走原因码：${code}`);
  }
  return code;
}
