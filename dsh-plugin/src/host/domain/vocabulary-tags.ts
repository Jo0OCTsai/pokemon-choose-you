/**
 * 背包词表 · 标签与维度（AD §5.2）——行为基准 = src-tauri/src/commands/tags.rs：
 * 维度 key/cardinality 建后不可改、维度内重名/配额满/停用拒绝（dsh 背包面强校验），
 * AI 路径（createTagInternal）幂等复用同名同维度标签。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";

/** 兜底维度 key：未指明维度的创建/解析请求归主题（tags.rs DEFAULT_DIMENSION） */
export const DEFAULT_DIMENSION = "topic";

// ---- 维度 ----

export interface TagDimension {
  id: number;
  key: string;
  name: string;
  cardinality: string;
  maxTags: number;
  sort: number;
  enabled: boolean;
}

export function listTagDimensions(conn: Conn): TagDimension[] {
  return (
    conn
      .prepare("SELECT id, key, name, cardinality, max_tags, sort, enabled FROM tag_dimensions ORDER BY sort, id")
      .all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: Number(r.id),
    key: String(r.key),
    name: String(r.name),
    cardinality: String(r.cardinality),
    maxTags: Number(r.max_tags),
    sort: Number(r.sort),
    enabled: Number(r.enabled) !== 0,
  }));
}

/** 维度 key → id（不存在或空 key 回落 topic；topic 也缺时错——库未初始化） */
export function dimensionIdByKey(conn: Conn, key: string): number {
  const normalized = key.trim() === "" ? DEFAULT_DIMENSION : key.trim();
  const row = conn.prepare("SELECT id FROM tag_dimensions WHERE key=?").get(normalized) as { id: number } | undefined;
  if (row === undefined) {
    throw paramError(`未知标签维度「${normalized}」`);
  }
  return Number(row.id);
}

/** 维度剩余可新建名额（max_tags - 现有标签数） */
export function dimensionRemaining(conn: Conn, dimId: number): number {
  const row = conn
    .prepare(
      "SELECT (SELECT max_tags FROM tag_dimensions WHERE id=?) AS max_tags, " +
        "(SELECT COUNT(*) FROM tags WHERE dimension_id=?) AS used",
    )
    .get(dimId, dimId) as { max_tags: number; used: number };
  return Number(row.max_tags) - Number(row.used);
}

export interface DimensionUpdate {
  key: string;
  name: string;
  maxTags?: number;
  enabled?: boolean;
}

/**
 * 维度更新（update_tag_dimension 同构 + dsh 契约约束）：改名/调上限/停用；
 * **key 与 cardinality 建后不可改**（前者是协议标识，后者牵涉存量数据语义）——
 * 本命令根本不收这两个字段，传入即报错（显式拒绝而非静默忽略）。
 */
export function dimensionUpdate(conn: Conn, input: DimensionUpdate): TagDimension {
  const name = input.name.trim();
  if (name === "") {
    throw paramError("维度名称不能为空");
  }
  const id = dimensionIdByKey(conn, input.key);
  const result = conn
    .prepare(
      "UPDATE tag_dimensions SET name=?, max_tags=COALESCE(?, max_tags), enabled=COALESCE(?, enabled) WHERE id=?",
    )
    .run(
      name,
      input.maxTags === undefined ? null : Math.min(200, Math.max(1, input.maxTags)),
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      id,
    );
  if (Number(result.changes) === 0) {
    throw notFound(`维度 ${input.key} 不存在`);
  }
  return listTagDimensions(conn).find((d) => d.id === id) as TagDimension;
}

// ---- 标签 ----

/** 派发元数据（tags.meta 列 JSON；仅 project 维度标签，老数据无此语义时为 null） */
export interface TagMeta {
  /** 派发工作目录（按 agent 位置解释：本地 = 本机路径，远程 = 远端路径；支持 ~ 前缀） */
  workdir?: string | null;
  /** 首选 agent（ai_agents 的 id；空 = 全局默认 agent） */
  agentId?: string | null;
  /** 该项目的补充上下文（技术栈/注意事项），拼进派发 prompt */
  context?: string | null;
}

export interface Tag {
  id: number;
  name: string;
  description: string;
  dimension: string;
  origin: string;
  createdAt: string;
  usage: number;
  meta: TagMeta | null;
}

const TAG_SELECT =
  "SELECT t.id, t.name, t.description, d.key AS dimension, t.origin, t.created_at, " +
  "(SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = t.id) AS usage, t.meta " +
  "FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id ";

/** tags.meta 列（JSON）解析：空/坏数据按无元数据处理，不让一条脏行拖垮整个列表 */
function parseTagMeta(raw: unknown): TagMeta | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as TagMeta;
  } catch {
    return null;
  }
}

export function listTags(conn: Conn): Tag[] {
  return (conn.prepare(TAG_SELECT + "ORDER BY d.sort, t.id").all() as Array<Record<string, unknown>>).map(tagFromRow);
}

function tagFromRow(r: Record<string, unknown>): Tag {
  return {
    id: Number(r.id),
    name: String(r.name),
    description: String(r.description),
    dimension: String(r.dimension),
    origin: String(r.origin),
    createdAt: String(r.created_at),
    usage: Number(r.usage),
    meta: parseTagMeta(r.meta),
  };
}

function tagById(conn: Conn, id: number): Tag {
  const row = conn.prepare(TAG_SELECT + "WHERE t.id=?").get(id);
  if (row === undefined) {
    throw notFound(`标签 ${id} 不存在`);
  }
  return tagFromRow(row as Record<string, unknown>);
}

/**
 * 标签创建原语（create_tag_conn 同构，AI 接受路径 / 自然语言捕捉复用）：
 * 归一空白、按维度查重（同名同维度已存在直接复用——幂等，不覆盖描述）、维度配额闸门。
 */
export function createTagInternal(
  conn: Conn,
  name: string,
  description: string,
  dimension: string,
  origin: string,
  now = nowRfc3339(),
): Tag {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw paramError("标签名不能为空");
  }
  const dimId = dimensionIdByKey(conn, dimension);
  const hit = conn.prepare("SELECT id FROM tags WHERE name=? AND dimension_id=?").get(trimmed, dimId) as
    { id: number } | undefined;
  if (hit !== undefined) {
    return tagById(conn, Number(hit.id)); // 幂等复用（AI 建议重放不报错）
  }
  if (dimensionRemaining(conn, dimId) <= 0) {
    const dimName = conn.prepare("SELECT name FROM tag_dimensions WHERE id=?").get(dimId) as {
      name: string;
    };
    throw paramError(`「${dimName.name}」维度标签已满（上限），先在设置里合并或清理后再新建`);
  }
  const result = conn
    .prepare("INSERT INTO tags (name, description, dimension_id, origin, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(trimmed, description, dimId, origin, now);
  return tagById(conn, Number(result.lastInsertRowid));
}

export interface TagUpsert {
  id?: number;
  name: string;
  dimension: string;
  description?: string;
}

/**
 * 背包面标签 upsert（dsh 契约强校验口径——比 AI 路径 createTagInternal 更严）：
 * 空名 / 维度停用 / 配额满 / 维度内重名（新建时）全部拒绝。
 */
export function tagUpsert(conn: Conn, input: TagUpsert, now = nowRfc3339()): Tag {
  const name = input.name.trim();
  if (name === "") {
    throw paramError("标签名不能为空");
  }
  const dimId = dimensionIdByKey(conn, input.dimension);
  const dim = listTagDimensions(conn).find((d) => d.id === dimId);
  if (input.id === undefined) {
    return createTagChecked(conn, name, input, dimId, dim, now);
  }
  // dimension 一并落库（update_tag 的 dimension_id=COALESCE 同构）——迁移维度是
  // 背包面标签管理的正式操作（桌面 TagsManagerCard 维度迁移下拉）
  const result = conn
    .prepare("UPDATE tags SET name=?, description=?, dimension_id=? WHERE id=?")
    .run(name, input.description ?? "", dimId, input.id);
  if (Number(result.changes) === 0) {
    throw notFound(`标签 ${input.id} 不存在`);
  }
  return tagById(conn, input.id);
}

/** 新建路径（dsh 契约强校验：维度停用 / 维度内重名拒绝，再走幂等创建原语） */
function createTagChecked(
  conn: Conn,
  name: string,
  input: TagUpsert,
  dimId: number,
  dim: TagDimension | undefined,
  now: string,
): Tag {
  if (dim !== undefined && !dim.enabled) {
    throw paramError(`维度「${dim.name}」已停用，不能在其中管理标签`);
  }
  const dup = conn.prepare("SELECT id FROM tags WHERE name=? AND dimension_id=?").get(name, dimId);
  if (dup !== undefined) {
    throw paramError(`维度「${dim?.name ?? input.dimension}」已有同名标签「${name}」`);
  }
  return createTagInternal(conn, name, input.description ?? "", input.dimension, "manual", now);
}

/** 删除标签：任务上的关联（task_tags）一并清理（delete_tag 同构） */
export function tagDelete(conn: Conn, id: number): { id: number } {
  conn.prepare("DELETE FROM task_tags WHERE tag_id=?").run(id);
  const result = conn.prepare("DELETE FROM tags WHERE id=?").run(id);
  if (Number(result.changes) === 0) {
    throw notFound(`标签 ${id} 不存在`);
  }
  return { id };
}
