/**
 * 面板手动新建（FR-C1 / AD §4.1 taskCreate；从 tasks.ts 拆出——棘轮 max-lines，
 * 等量迁移；tasks.ts 为统一再出口，消费面不变）：多分类/标签存在性前置校验，
 * 状态 = scheduledFor 有值 ? scheduled : inbox，写路径单条 BEGIN IMMEDIATE 收口。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { logChange } from "./task-audit";
import { enforceInboxInvariant, firstEnabledCategoryId, getTask, setTaskTags, type Task } from "./tasks";

/** 面板手动新建入参（命令面契约字段：due/scheduledFor 为字符串时间） */
export interface ManualTaskCreateInput {
  title: string;
  note?: string | null;
  categoryId?: number;
  priority?: string;
  due?: string | null;
  remindAt?: string | null;
  /** 排期时间：有值 → 状态 scheduled；值兜底落 due_at（桌面「due + scheduled
   * 同补丁」的 reschedule 同构——scheduled 状态在草丛不变量下需要非空截止站住） */
  scheduledFor?: string | null;
  tagIds?: number[];
}

/** 空白字符串归 null（due/scheduledFor 参与状态推导前的归一） */
function trimToNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t === undefined || t === "" ? null : t;
}

/** tagIds 中不存在的标签 id（存在性校验用） */
function missingTagIds(conn: Conn, tagIds: number[]): number[] {
  if (tagIds.length === 0) {
    return [];
  }
  const placeholders = tagIds.map(() => "?").join(",");
  const found = new Set(
    (
      conn.prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`).all(...tagIds) as Array<{
        id: number;
      }>
    ).map((r) => Number(r.id)),
  );
  return tagIds.filter((id) => !found.has(id));
}

/**
 * 面板手动新建（区别于收音机捕获链路的 createTask）：多分类/标签存在性前置校验
 * （校验失败 0 行变更），状态 = scheduledFor 有值 ? scheduled : inbox，写路径
 * 单条 BEGIN IMMEDIATE 收口（INSERT + 标签关联 + 不变量 + create 审计原子提交）。
 */
export function createTaskManual(conn: Conn, input: ManualTaskCreateInput, origin = "panel", now = nowRfc3339()): Task {
  const title = input.title.trim();
  if (title === "") {
    throw paramError("标题不能为空");
  }
  const categoryId = input.categoryId ?? firstEnabledCategoryId(conn);
  if (conn.prepare("SELECT 1 FROM categories WHERE id=?").get(categoryId) === undefined) {
    throw paramError(`分类 ${categoryId} 不存在`);
  }
  const tagIds = input.tagIds ?? [];
  const missing = missingTagIds(conn, tagIds);
  if (missing.length > 0) {
    throw paramError(`标签不存在：${missing.join(", ")}`);
  }
  const scheduledFor = trimToNull(input.scheduledFor);
  const dueAt = trimToNull(input.due) ?? scheduledFor;
  const status = scheduledFor !== null ? "scheduled" : "inbox";
  const id = txImmediate(conn, () => {
    const result = conn
      .prepare(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, remind_at, source, external_id, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?)",
      )
      .run(
        title,
        input.note ?? null,
        categoryId,
        status,
        input.priority ?? "normal",
        dueAt,
        input.remindAt ?? null,
        now,
      );
    const newId = Number(result.lastInsertRowid);
    setTaskTags(conn, newId, tagIds);
    enforceInboxInvariant(conn, newId);
    logChange(conn, newId, "create", "title", null, title, origin, now);
    return newId;
  });
  return getTask(conn, id);
}
