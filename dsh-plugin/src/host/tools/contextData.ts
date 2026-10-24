/**
 * todo_context 工具的数据面（pk context.rs 同构）：假名化词表 + 标签移除负反馈 +
 * 维度剩余名额 + 分类/标签名解析辅助。与 todoTaskTools 分文件以控复杂度棘轮口径。
 */
import { type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { AnonRules } from "../domain/anonymize";
import { listCategories } from "../domain/vocabulary";
import { dimensionIdByKey, dimensionRemaining, listTagDimensions, listTags } from "../domain/vocabulary-tags";

/** 本地时间 YYYY-MM-DDTHH:MM（pk context 的 chrono::Local 同形态） */
function localNow(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 标签移除负反馈（tags.rs removal_feedback 同构：30 天窗口、≥2 次、最多 3 条） */
function removalFeedback(conn: Conn): Array<{ name: string; removed: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace("Z", "+00:00");
  const rows = conn
    .prepare(
      "SELECT old_value, new_value FROM task_logs WHERE action='update' AND field='tags' " +
        "AND created_at >= ? ORDER BY id DESC LIMIT 500",
    )
    .all(cutoff) as Array<{ old_value: string | null; new_value: string | null }>;
  const counts = new Map<string, number>();
  for (const { old_value: old, new_value: updated } of rows) {
    tallyRemovals(old, updated ?? "", counts);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, removed]) => ({ name, removed }));
}

/** 一行 diff 的移除计数（old 中被 new 保留集剔除的名字各 +1） */
function tallyRemovals(old: string | null, updated: string, counts: Map<string, number>): void {
  if (old === null || old === "") {
    return;
  }
  const kept = new Set(
    updated
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
  for (const name of old
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !kept.has(s))) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
}

/** 词表判定上下文（pk context 同构；标题/标签名过假名化 scrub_titles） */
export function buildToolContextData(conn: Conn): Record<string, unknown> {
  const rules = AnonRules.build(conn);
  const openTasks = (
    conn
      .prepare("SELECT id, title FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY id")
      .all() as Array<{
      id: number;
      title: string;
    }>
  ).map((t) => ({ id: t.id, title: rules.scrubTitles(t.title) }));
  const categories = listCategories(conn)
    .filter((c) => c.enabled)
    .map((c) => ({ id: c.id, name: c.name, description: c.description }));
  const tags = listTags(conn).map((t) => ({
    id: t.id,
    name: rules.scrubTitles(t.name),
    description: t.description,
    dimension: t.dimension,
  }));
  return {
    now: localNow(),
    openTasks,
    categories,
    tags,
    dimensions: dimensionSummaries(conn),
    tagFeedback: removalFeedback(conn).map((f) => ({ name: rules.scrubTitles(f.name), removed: f.removed })),
  };
}

/** 维度元信息（AI 提议新标签前对照剩余名额；remaining<=0 禁止新建） */
function dimensionSummaries(conn: Conn): Array<Record<string, unknown>> {
  return listTagDimensions(conn).map((d) => ({
    key: d.key,
    name: d.name,
    cardinality: d.cardinality,
    maxTags: d.maxTags,
    remaining: dimensionRemaining(conn, dimensionIdByKey(conn, d.key)),
  }));
}

/** 分类名 → id（启用中；认不出报参数错——分类必须来自 context 词表） */
export function categoryIdByName(conn: Conn, name: string): number {
  const hit = conn.prepare("SELECT id FROM categories WHERE name=? AND enabled=1").get(name.trim()) as
    { id: number } | undefined;
  if (hit === undefined) {
    throw paramError(`未知分类「${name}」，可用分类见 todo_context 词表`);
  }
  return Number(hit.id);
}

/** 标签名 → id（按名全局兜底；词表外报参数错） */
export function tagIdsByNames(conn: Conn, names: string[]): number[] {
  const ids: number[] = [];
  for (const name of names.map((n) => n.trim()).filter((n) => n !== "")) {
    const hit = conn.prepare("SELECT id FROM tags WHERE name=?").get(name) as { id: number } | undefined;
    if (hit === undefined) {
      throw paramError(`未知标签「${name}」，可用标签见 todo_context 词表（新标签走设置或建议的 isNew）`);
    }
    ids.push(Number(hit.id));
  }
  return ids;
}
