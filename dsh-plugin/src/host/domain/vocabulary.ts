/**
 * 背包词表 · 分类（AD §5.2 背包词表面）——主应用现行管理面同源表直写，
 * 级联与不变式对齐主应用。行为基准 = src-tauri/src/commands/categories.rs。
 * 标签/维度见 vocabulary-tags.ts；会话过滤见 vocabulary-filters.ts。
 */
import { type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";

export {
  DEFAULT_DIMENSION,
  listTagDimensions,
  dimensionIdByKey,
  dimensionRemaining,
  listTags,
  createTagInternal,
  tagUpsert,
  tagDelete,
} from "./vocabulary-tags";

// ---- 分类 ----

export interface Category {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  enabled: boolean;
  description: string;
}

export function listCategories(conn: Conn): Category[] {
  return (
    conn.prepare("SELECT id, name, pokemon, sprite, enabled, description FROM categories ORDER BY id").all() as Array<
      Record<string, unknown>
    >
  ).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    pokemon: String(row.pokemon),
    sprite: String(row.sprite),
    enabled: Number(row.enabled) !== 0,
    description: String(row.description),
  }));
}

/** 空名校验 + 重名校验（name UNIQUE：提前给出可操作报错而非裸库错误） */
function assertCategoryName(conn: Conn, name: string, excludeId?: number): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw paramError("分类名不能为空");
  }
  const hit = conn.prepare("SELECT id FROM categories WHERE name=?").get(trimmed) as { id: number } | undefined;
  if (hit !== undefined && hit.id !== excludeId) {
    throw paramError(`分类「${trimmed}」已存在`, "分类名不可重复");
  }
  return trimmed;
}

export interface CategoryUpsert {
  id?: number;
  /** 缺省 = 不改（纯启停/换装场景）；新建必填 */
  name?: string;
  /** 换装绑定（A23：与 set_category_pokemon 合并为 upsert 参数） */
  pokemon?: string;
  sprite?: string;
  enabled?: boolean;
  description?: string;
}

/**
 * 分类 upsert（新增/改名/换装/启停一体）：新建必填名（去空格、拒重名）；
 * 更新时 name 缺省保持原名；停用最后一个启用分类拒绝（至少保留一个启用，
 * 对齐 set_category_enabled 守卫）。
 */
export function categoryUpsert(conn: Conn, input: CategoryUpsert): Category {
  if (input.id === undefined) {
    return createCategory(conn, input);
  }
  const existing = categoryById(conn, input.id);
  const name = input.name === undefined ? existing.name : assertCategoryName(conn, input.name, input.id);
  assertNotLastEnabled(conn, input, existing);
  conn
    .prepare("UPDATE categories SET name=?, pokemon=?, sprite=?, description=?, enabled=? WHERE id=?")
    .run(
      name,
      input.pokemon ?? existing.pokemon,
      input.sprite ?? existing.sprite,
      input.description?.trim() ?? existing.description,
      input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0,
      input.id,
    );
  return categoryById(conn, input.id);
}

function createCategory(conn: Conn, input: CategoryUpsert): Category {
  const name = assertCategoryName(conn, input.name ?? "");
  const result = conn
    .prepare("INSERT INTO categories (name, pokemon, sprite, enabled, description) VALUES (?, ?, ?, 1, ?)")
    .run(name, input.pokemon ?? "", input.sprite ?? "", input.description?.trim() ?? "");
  const row = conn.prepare("SELECT id FROM categories WHERE rowid=?").get(result.lastInsertRowid);
  return categoryById(conn, Number((row as { id: number }).id));
}

/** 停用守卫：停用时至少保留一个其他启用中的分类（对齐 set_category_enabled） */
function assertNotLastEnabled(conn: Conn, input: CategoryUpsert, existing: Category): void {
  if (input.enabled !== false || !existing.enabled || input.id === undefined) {
    return;
  }
  {
    const rest = conn.prepare("SELECT COUNT(*) AS n FROM categories WHERE enabled=1 AND id != ?").get(input.id) as {
      n: number;
    };
    if (rest.n === 0) {
      throw paramError("至少保留一个启用中的分类");
    }
  }
}

function categoryById(conn: Conn, id: number): Category {
  const row = conn.prepare("SELECT id, name, pokemon, sprite, enabled, description FROM categories WHERE id=?").get(id);
  if (row === undefined) {
    throw notFound(`分类 ${id} 不存在`);
  }
  const r = row as Record<string, unknown>;
  return {
    id: Number(r.id),
    name: String(r.name),
    pokemon: String(r.pokemon),
    sprite: String(r.sprite),
    enabled: Number(r.enabled) !== 0,
    description: String(r.description),
  };
}

/**
 * 放生分类（delete_category 同构）：其下任务移回第一个启用分类（被删的正好是唯一
 * 启用分类时退而求其次）；不允许删除最后一个分类。返回被迁移的任务数。
 */
export function categoryDelete(conn: Conn, id: number): { id: number; movedTaskCount: number } {
  const count = conn.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (count.n <= 1) {
    throw paramError("至少保留一个分类");
  }
  let fallback = conn.prepare("SELECT id FROM categories WHERE enabled=1 AND id != ? ORDER BY id LIMIT 1").get(id) as
    { id: number } | undefined;
  if (fallback === undefined) {
    fallback = conn.prepare("SELECT id FROM categories WHERE id != ? ORDER BY id LIMIT 1").get(id) as {
      id: number;
    };
  }
  const moved = conn.prepare("UPDATE tasks SET category_id=? WHERE category_id=?").run(fallback.id, id);
  const result = conn.prepare("DELETE FROM categories WHERE id=?").run(id);
  if (Number(result.changes) === 0) {
    throw notFound(`分类 ${id} 不存在`);
  }
  return { id, movedTaskCount: Number(moved.changes) };
}
