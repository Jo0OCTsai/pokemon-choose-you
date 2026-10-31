/**
 * task 建改子命令（对齐 bin/pk/task.rs 的 create/update 分支；从 task.ts 拆件控复杂度）。
 * dry-run 只校验回显不落库（分类/标签存在性与目标待办存在性照常校验）。
 */
import type { Conn } from "../host/storage/db";
import { createTask, updateTask, type NewTask, type TaskPatch } from "../host/domain/tasks";
import { CliError, flag, usageErr, validateChoice, VALID_PRIORITY, VALID_STATUS, type Parsed } from "./cli";
import { resolveCategory, resolveTagIds, timeValue } from "./tag";

/** --due/--remind 时间值允许 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（validate_due 同构） */
export function validateDue(v: string): void {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return;
  throw usageErr(`时间「${v}」无效，应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM`);
}

/** 待办 id 是否存在（dry-run 与 suggest 校验共用） */
export function taskExists(conn: Conn, id: number): boolean {
  return conn.prepare("SELECT id FROM tasks WHERE id=?").get(id) !== undefined;
}

function nonEmptyStr(v: string | undefined): string | undefined {
  return v !== undefined && v !== "" ? v : undefined;
}

function splitTags(raw: string | undefined): string[] {
  return raw === undefined || raw === ""
    ? []
    : raw
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter((s) => s !== "");
}

/** create 旗标解析（优先级/时间校验/分类与标签解析） */
function parseCreateFlags(
  conn: Conn,
  p: Parameters<typeof flag>[0],
): {
  priority: string;
  due: string | undefined;
  categoryRaw: string | undefined;
  categoryId: number | undefined;
  tagsRaw: string | undefined;
  tagIds: number[] | undefined;
} {
  const priorityRaw = flag(p, "priority");
  let priority = "normal";
  if (priorityRaw !== undefined && priorityRaw !== "") {
    validateChoice(priorityRaw, VALID_PRIORITY, "优先级");
    priority = priorityRaw;
  }
  const dueRaw = flag(p, "due");
  const due = dueRaw !== undefined && dueRaw !== "" ? dueRaw : undefined;
  if (due !== undefined) validateDue(due);
  const categoryRaw = flag(p, "category");
  const categoryId = categoryRaw !== undefined && categoryRaw !== "" ? resolveCategory(conn, categoryRaw) : undefined;
  const tagsRaw = flag(p, "tags");
  const tagIds = tagsRaw !== undefined && tagsRaw !== "" ? resolveTagIds(conn, tagsRaw) : undefined;
  return { priority, due, categoryRaw, categoryId, tagsRaw, tagIds };
}

/** 建任务（--dry-run 只校验回显不落库） */
export function runTaskCreate(conn: Conn, p: Parsed): unknown {
  const title = flag(p, "title")?.trim();
  if (title === undefined || title === "") throw usageErr("task create 需要 --title");
  const f = parseCreateFlags(conn, p);
  // 有截止时间即视为排期（scheduled），与收音机建待办的规则一致
  const scheduled = flag(p, "scheduled") !== undefined || f.due !== undefined;
  const note = nonEmptyStr(flag(p, "note"));
  const remind = nonEmptyStr(flag(p, "remind"));
  if (flag(p, "dry-run") !== undefined) {
    return taskCreateDryRun(title, note, remind, f, scheduled);
  }
  const input: NewTask = {
    title,
    note: note ?? null,
    categoryId: f.categoryId,
    priority: f.priority,
    dueAt: f.due ?? null,
    remindAt: remind ?? null,
    scheduled,
    source: "cli",
    externalId: null,
    tagIds: f.tagIds,
  };
  return { created: createTask(conn, input, "cli") };
}

/** --dry-run 回显（参数已全部照常校验，只组装将创建的内容不落库） */
function taskCreateDryRun(
  title: string,
  note: string | undefined,
  remind: string | undefined,
  f: ReturnType<typeof parseCreateFlags>,
  scheduled: boolean,
): unknown {
  return {
    dryRun: true,
    wouldCreate: {
      title,
      note: note ?? null,
      category: nonEmptyStr(f.categoryRaw) ?? null,
      priority: f.priority,
      due: f.due ?? null,
      remind: remind ?? null,
      tags: splitTags(f.tagsRaw),
      scheduled,
      source: "cli",
    },
  };
}

/** 更新字段（--due 空串清空；--dry-run 只校验回显） */
export function runTaskUpdate(conn: Conn, p: Parsed, id: number): unknown {
  const status = choiceOf(p, "status", VALID_STATUS, "状态");
  const priority = choiceOf(p, "priority", VALID_PRIORITY, "优先级");
  const dueRaw = flag(p, "due");
  let due: string | null | undefined;
  if (dueRaw !== undefined) {
    // 传过 --due 即视为要改：空串清空、非空设置
    if (dueRaw !== "") validateDue(dueRaw);
    due = timeValue(dueRaw);
  }
  const remindRaw = flag(p, "remind");
  const remind = remindRaw === undefined ? undefined : timeValue(remindRaw);
  const categoryRaw = flag(p, "category");
  const categoryId = categoryRaw !== undefined && categoryRaw !== "" ? resolveCategory(conn, categoryRaw) : undefined;
  const tagsRaw = flag(p, "tags");
  const tagIds = tagsRaw !== undefined ? resolveTagIds(conn, tagsRaw) : undefined;
  if (flag(p, "dry-run") !== undefined) {
    return taskUpdateDryRun(conn, p, { id, priority, due, remind, status });
  }
  const patch: TaskPatch = {
    id,
    title: nonEmptyStr(flag(p, "title")),
    note: flag(p, "note"),
    categoryId,
    priority,
    dueAt: due,
    remindAt: remind,
    status,
    tagIds,
  };
  return { updated: updateTask(conn, patch, "cli") };
}

function taskUpdateDryRun(
  conn: Conn,
  p: Parsed,
  a: { id: number; priority?: string; due?: string | null; remind?: string | null; status?: string },
): unknown {
  // --dry-run 校验照常（含目标待办存在性），只回显将变更的字段
  if (!taskExists(conn, a.id)) {
    throw new CliError(`任务 ${a.id} 不存在（先用 pk task list 查 id）`, 1);
  }
  return {
    dryRun: true,
    wouldUpdate: {
      id: a.id,
      title: nonEmptyStr(flag(p, "title")) ?? null,
      note: flag(p, "note") ?? null,
      category: nonEmptyStr(flag(p, "category")) ?? null,
      priority: a.priority ?? null,
      due: a.due ?? null,
      remind: a.remind ?? null,
      status: a.status ?? null,
      tags: nonEmptyStr(flag(p, "tags")) ?? null,
    },
  };
}

/** 受限枚举旗标（空/缺席 = 不改，undefined） */
function choiceOf(
  p: Parameters<typeof flag>[0],
  key: string,
  allowed: readonly string[],
  what: string,
): string | undefined {
  const raw = flag(p, key);
  if (raw === undefined || raw === "") return undefined;
  validateChoice(raw, allowed, what);
  return raw;
}
